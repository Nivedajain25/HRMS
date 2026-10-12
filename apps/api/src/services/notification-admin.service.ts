import { Types } from 'mongoose';
import {
  fillPlaceholders,
  NOTIFICATION_EVENT_INFO,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationPreviewInput,
  type NotificationRulesUpdate,
} from '@stencil/shared';
import { renderBranded } from '../emails/templates';
import { EmailLogModel, NotificationDispatchModel, OrganizationModel, UserModel } from '../models';
import type { RequestContext } from '../types/context';
import { badRequest, notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { audit } from './audit.service';
import { resendEmail, sendRenderedEmail } from './email.service';
import { getNotificationRules, mergeRules } from './notification-dispatch.service';

/**
 * Settings → Notification rules (settings:manage) and Settings → Notification log (audit:read): the automated
 * notification rules, template preview / test send, the delivery log, and re-sending failed emails.
 */

/* ------------------------------- Rules ------------------------------- */

const eventCatalog = () =>
  NOTIFICATION_EVENTS.map((event) => {
    const info = NOTIFICATION_EVENT_INFO[event];
    return { event, label: info.label, group: info.group, description: info.description, recipients: info.recipients, placeholders: info.placeholders, defaults: info.defaults };
  });

export const getNotificationSettings = async (ctx: RequestContext) => {
  const org = await OrganizationModel.findById(ctx.organizationId).select('settings.notificationRules').lean();
  const saved = ((org?.settings as { notificationRules?: Record<string, unknown> } | undefined)?.notificationRules ?? {}) as Record<string, unknown>;
  return {
    events: eventCatalog(),
    rules: mergeRules(saved),
    /** Events with saved changes (the rest use the defaults). */
    customized: NOTIFICATION_EVENTS.filter((e) => saved[e] && Object.keys(saved[e] as object).length > 0),
  };
};

export const updateNotificationSettings = async (ctx: RequestContext, input: NotificationRulesUpdate) => {
  const org = await OrganizationModel.findById(ctx.organizationId).select('settings.notificationRules').lean();
  const before = { ...(((org?.settings as { notificationRules?: Record<string, unknown> } | undefined)?.notificationRules ?? {}) as Record<string, unknown>) };
  const next: Record<string, unknown> = { ...before };
  for (const [event, rule] of Object.entries(input.rules ?? {})) {
    if (!(NOTIFICATION_EVENTS as readonly string[]).includes(event)) continue;
    const info = NOTIFICATION_EVENT_INFO[event as NotificationEvent];
    if (rule === null) {
      delete next[event]; // back to the defaults
      continue;
    }
    if (rule.recipients?.some((r) => !info.recipients.includes(r))) {
      throw badRequest(`Some recipients don't apply to "${info.label}"`, 'VALIDATION_ERROR', [{ path: `rules.${event}.recipients`, message: 'Not available for this event' }]);
    }
    next[event] = { ...((before[event] as object) ?? {}), ...rule };
  }
  await OrganizationModel.updateOne({ _id: ctx.organizationId }, { $set: { 'settings.notificationRules': next } });
  await audit(ctx, {
    action: 'ORGANIZATION_UPDATED',
    module: 'settings',
    recordId: ctx.organizationId,
    recordLabel: 'Notification rules',
    oldValues: { notificationRules: before },
    newValues: { notificationRules: next },
  });
  return getNotificationSettings(ctx);
};

const SAMPLE: Record<string, string> = {
  employeeName: 'Ananya Sharma',
  employeeCode: 'EMP0042',
  leaveType: 'Casual Leave',
  dates: '2026-11-03 to 2026-11-04',
  days: '2 days',
  reason: 'Family function',
  note: 'Comment: Enjoy your time off.',
  approver: 'the reporting manager',
  managerName: 'Rahul Verma',
  candidateName: 'Priya Nair',
  jobTitle: 'Sales Executive',
  when: '2026-11-05 11:00 (Asia/Kolkata)',
  round: 'Round 2',
  interviewType: 'video call',
  meetingLink: 'https://meet.example.com/abc-defg-hij',
  location: '',
  interviewers: 'Rahul Verma, Ananya Sharma',
  result: 'Hire',
  rating: '4 / 5',
};

/** Renders an event's email with sample data (unsaved edits in `rule` are applied); optionally emails it to the caller. */
export const previewNotification = async (ctx: RequestContext, input: NotificationPreviewInput) => {
  const rules = await getNotificationRules(ctx.organizationId);
  const rule = { ...rules[input.event], ...Object.fromEntries(Object.entries(input.rule ?? {}).filter(([, v]) => v !== undefined && v !== '')) };
  const org = await OrganizationModel.findById(ctx.organizationId).select('name').lean();
  const vars = { ...SAMPLE, organization: org?.name ?? '', actorName: ctx.userName, link: 'https://hrms.example.com/…' };
  const self = input.audience === 'self';
  const title = fillPlaceholders(self ? rule.selfSubject : rule.subject, vars).replace(/\s+/g, ' ').trim();
  const body = fillPlaceholders(self ? rule.selfBody : rule.body, vars);
  const rendered = renderBranded({ title, body, link: '/notifications', organization: org?.name ?? undefined });
  let sentTo: string | null = null;
  if (input.sendTest) {
    const me = await UserModel.findById(ctx.userId).select('email').lean();
    if (!me?.email) throw badRequest('Your account has no email address', 'NO_EMAIL');
    await sendRenderedEmail({ to: [me.email], template: `test:${input.event}`, rendered: { ...rendered, subject: `[Test] ${rendered.subject}` }, organizationId: ctx.organizationId });
    sentTo = me.email;
  }
  return { ...rendered, sentTo };
};

/* -------------------------------- Log -------------------------------- */

interface LogQuery {
  page?: number;
  limit?: number;
  event?: string;
  status?: 'SENT' | 'FAILED' | 'PENDING' | 'ESCALATED' | 'NO_RECIPIENTS' | 'DISABLED' | 'ERROR';
  q?: string;
  from?: string;
  to?: string;
}

/** Delivery of a notification's emails, from their logs. */
const emailSummary = (logs: { status: string }[]) => {
  if (!logs.length) return 'NONE';
  if (logs.some((l) => l.status === 'FAILED')) return logs.every((l) => l.status === 'FAILED') ? 'FAILED' : 'PARTIAL';
  if (logs.some((l) => l.status === 'QUEUED' || l.status === 'RETRYING')) return 'PENDING';
  return logs.every((l) => l.status === 'SKIPPED') ? 'NOT_CONFIGURED' : 'SENT';
};

export const listNotificationLog = async (ctx: RequestContext, q: LogQuery) => {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
  const filter: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (q.event) filter.event = q.event;
  if (q.status === 'ESCALATED') filter['escalations.0'] = { $exists: true };
  else if (q.status === 'NO_RECIPIENTS' || q.status === 'DISABLED' || q.status === 'ERROR') filter.outcome = q.status;
  if (q.status === 'FAILED' || q.status === 'PENDING') {
    const statuses = q.status === 'FAILED' ? ['FAILED'] : ['QUEUED', 'RETRYING'];
    const ids = await EmailLogModel.distinct('dispatchId', { organizationId: ctx.organizationId, status: { $in: statuses }, dispatchId: { $ne: null } });
    filter._id = { $in: ids };
  }
  if (q.q?.trim()) {
    const rx = new RegExp(q.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { 'recipients.name': rx }, { 'recipients.email': rx }, { actorName: rx }];
  }
  if (q.from || q.to) {
    filter.createdAt = { ...(q.from ? { $gte: new Date(`${q.from}T00:00:00.000Z`) } : {}), ...(q.to ? { $lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) };
  }
  const [items, total] = await Promise.all([
    NotificationDispatchModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    NotificationDispatchModel.countDocuments(filter),
  ]);
  const logs = await EmailLogModel.find({ _id: { $in: items.flatMap((i) => i.emailLogIds ?? []) } }).select('status').lean();
  const statusById = new Map(logs.map((l) => [String(l._id), l]));
  return {
    items: items.map((i) => ({
      ...i,
      label: NOTIFICATION_EVENT_INFO[i.event as NotificationEvent]?.label ?? i.event,
      email: emailSummary((i.emailLogIds ?? []).map((id) => statusById.get(String(id))).filter((l): l is NonNullable<typeof l> => !!l)),
      counts: {
        inApp: (i.recipients ?? []).filter((r) => r.inApp).length,
        to: (i.recipients ?? []).filter((r) => r.emailAs === 'TO').length,
        cc: (i.recipients ?? []).filter((r) => r.emailAs === 'CC').length,
        skipped: (i.recipients ?? []).filter((r) => r.skipped).length,
      },
    })),
    pagination: buildPagination(page, limit, total),
  };
};

export const getNotificationLogEntry = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Notification');
  const entry = await NotificationDispatchModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean();
  if (!entry) throw notFound('Notification');
  const emails = await EmailLogModel.find({ _id: { $in: entry.emailLogIds ?? [] }, organizationId: ctx.organizationId })
    .select('to cc subject status error attempts lastAttemptAt sentAt createdAt template')
    .lean();
  return { ...entry, label: NOTIFICATION_EVENT_INFO[entry.event as NotificationEvent]?.label ?? entry.event, emails };
};

export const retryNotificationEmail = async (ctx: RequestContext, emailLogId: string) => {
  if (!Types.ObjectId.isValid(emailLogId)) throw notFound('Email');
  const log = await EmailLogModel.findOne({ _id: emailLogId, organizationId: ctx.organizationId }).select('status to subject dispatchId').lean();
  if (!log) throw notFound('Email');
  if (log.status !== 'FAILED') throw badRequest('Only failed emails can be re-sent', 'NOT_FAILED');
  if (!(await resendEmail(ctx.organizationId, emailLogId))) throw badRequest('This email can no longer be re-sent', 'NOT_RESENDABLE');
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'notifications', recordId: log._id, recordLabel: `Re-sent email: ${log.subject ?? ''}`, newValues: { to: log.to } });
  return EmailLogModel.findById(emailLogId).select('to cc subject status error attempts lastAttemptAt sentAt').lean();
};
