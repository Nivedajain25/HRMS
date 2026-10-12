import { Types } from 'mongoose';
import {
  fillPlaceholders,
  NOTIFICATION_EVENT_INFO,
  NOTIFICATION_EVENTS,
  SELF_RECIPIENTS,
  type NotificationEvent,
  type NotificationRecipient,
  type NotificationRule,
} from '@stencil/shared';
import { logger } from '../config/logger';
import { appUrl, renderBranded } from '../emails/templates';
import { EmployeeModel, JobOpeningModel, LeaveRequestModel, NotificationDispatchModel, OrganizationModel, RoleModel, UserModel } from '../models';
import { todayKey } from '../utils/dates';
import { sendRenderedEmail } from './email.service';
import { notify } from './notification.service';

/**
 * Automated HR notifications. `dispatchNotification()` is called by the leave and interview services when something
 * happens; it applies the organization's rule for the event (Settings → Notification rules), works out who should
 * hear about it from the org chart and roles, sends in-app + push notifications and branded emails (HR in CC for
 * leave), escalates past a reporting manager who is on leave or unavailable, and records everything in the
 * notification log. It never throws into the business flow.
 */

type Id = Types.ObjectId;
type Vars = Record<string, string | number | null | undefined>;

/* ------------------------------- Rules ------------------------------- */

export type NotificationRules = Record<NotificationEvent, NotificationRule>;

/** Saved overrides merged over the defaults (unknown or malformed fields are ignored). */
export const mergeRules = (saved: unknown): NotificationRules => {
  const overrides = (saved && typeof saved === 'object' ? saved : {}) as Record<string, Partial<NotificationRule> | null>;
  const out = {} as NotificationRules;
  for (const event of NOTIFICATION_EVENTS) {
    const info = NOTIFICATION_EVENT_INFO[event];
    const o = overrides[event] ?? {};
    const pick = <K extends keyof NotificationRule>(k: K, ok: (v: unknown) => boolean) => (ok(o[k]) ? (o[k] as NotificationRule[K]) : info.defaults[k]);
    const isBool = (v: unknown) => typeof v === 'boolean';
    const isText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
    out[event] = {
      enabled: pick('enabled', isBool),
      inApp: pick('inApp', isBool),
      email: pick('email', isBool),
      ccHr: pick('ccHr', isBool),
      escalate: pick('escalate', isBool),
      recipients: Array.isArray(o.recipients) ? o.recipients.filter((r) => info.recipients.includes(r)) : info.defaults.recipients,
      subject: pick('subject', isText),
      body: pick('body', isText),
      selfSubject: pick('selfSubject', isText),
      selfBody: pick('selfBody', isText),
    };
  }
  return out;
};

export const getNotificationRules = async (organizationId: Id) => {
  const org = await OrganizationModel.findById(organizationId).select('settings.notificationRules').lean();
  return mergeRules((org?.settings as { notificationRules?: unknown } | undefined)?.notificationRules);
};

/* --------------------------- Recipient lookup --------------------------- */

interface Person {
  role: NotificationRecipient | 'APPROVER';
  userId: Id | null;
  employeeId: Id | null;
  name: string;
  email: string | null;
}

const fullName = (p: { firstName?: string | null; lastName?: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ').trim();

/** Active users holding any of these role keys. */
const usersWithRoles = async (organizationId: Id, keys: string[], role: Person['role']): Promise<Person[]> => {
  const roles = await RoleModel.find({ organizationId, key: { $in: keys } }).select('_id').lean();
  if (!roles.length) return [];
  const users = await UserModel.find({ organizationId, status: 'ACTIVE', roles: { $in: roles.map((r) => r._id) } })
    .select('_id email firstName lastName employeeId')
    .lean();
  return users.map((u) => ({ role, userId: u._id, employeeId: (u.employeeId as Id | null) ?? null, name: fullName(u), email: u.email ?? null }));
};

const peopleForUserIds = async (organizationId: Id, userIds: Id[], role: Person['role']): Promise<Person[]> => {
  if (!userIds.length) return [];
  const users = await UserModel.find({ _id: { $in: userIds }, organizationId, status: 'ACTIVE' }).select('_id email firstName lastName employeeId').lean();
  return users.map((u) => ({ role, userId: u._id, employeeId: (u.employeeId as Id | null) ?? null, name: fullName(u), email: u.email ?? null }));
};

type EmployeeRow = { _id: Id; firstName: string; lastName: string; workEmail?: string | null; userId?: Id | null; managerId?: Id | null; employmentStatus?: string | null };

const loadEmployees = async (organizationId: Id, ids: Id[]) => {
  if (!ids.length) return [] as EmployeeRow[];
  return EmployeeModel.find({ _id: { $in: ids }, organizationId, deletedAt: null })
    .select('_id firstName lastName workEmail userId managerId employmentStatus')
    .lean<EmployeeRow[]>();
};

/** Employees as recipients: their login account when they have one (email from the account), else their work email. */
const peopleForEmployees = async (organizationId: Id, employees: EmployeeRow[], role: Person['role']): Promise<Person[]> => {
  const userIds = employees.map((e) => e.userId).filter((u): u is Id => !!u);
  const users = userIds.length
    ? await UserModel.find({ _id: { $in: userIds }, organizationId, status: 'ACTIVE' }).select('_id email').lean()
    : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return employees.map((e) => {
    const user = e.userId ? byId.get(String(e.userId)) : undefined;
    return { role, userId: user?._id ?? null, employeeId: e._id, name: fullName(e), email: user?.email ?? e.workEmail ?? null };
  });
};

const UNAVAILABLE_STATUS: Record<string, string> = { ON_LEAVE: 'marked on leave', EXITED: 'has left the organization', ARCHIVED: 'is archived' };

/**
 * The reporting manager who should hear about it: the employee's manager, or — when that manager is on approved
 * leave today, marked on leave, has left, or can't be reached (no account and no email) — the next manager up the
 * reporting line. Every skipped manager is recorded as an escalation.
 */
export const resolveManager = async (organizationId: Id, employee: { managerId?: Id | null }, escalate: boolean) => {
  const escalations: { fromEmployeeId: Id; fromName: string; toEmployeeId: Id | null; toName: string; reason: string }[] = [];
  const org = await OrganizationModel.findById(organizationId).select('timezone').lean();
  const today = new Date(`${todayKey(org?.timezone ?? 'UTC')}T00:00:00.000Z`);
  const seen = new Set<string>();
  let current = employee.managerId ?? null;
  let skipped: { emp: EmployeeRow; reason: string } | null = null;
  for (let depth = 0; current && depth < 12 && !seen.has(String(current)); depth++) {
    seen.add(String(current));
    const [manager] = await loadEmployees(organizationId, [current]);
    if (!manager) break;
    let reason: string | null = UNAVAILABLE_STATUS[manager.employmentStatus ?? ''] ?? null;
    if (!reason) {
      const onLeave = await LeaveRequestModel.exists({
        organizationId,
        employeeId: manager._id,
        status: 'APPROVED',
        startDate: { $lte: today },
        endDate: { $gte: today },
      });
      if (onLeave) reason = 'is on leave today';
    }
    const [person] = await peopleForEmployees(organizationId, [manager], 'MANAGER');
    if (!reason && !person?.email && !person?.userId) reason = 'has no account or email';
    if (skipped) escalations[escalations.length - 1]!.toEmployeeId = manager._id;
    if (skipped) escalations[escalations.length - 1]!.toName = fullName(manager);
    if (!reason) return { manager: person ?? null, escalations };
    if (!escalate) return { manager: null, escalations: [{ fromEmployeeId: manager._id, fromName: fullName(manager), toEmployeeId: null, toName: 'nobody (escalation is off)', reason }] };
    skipped = { emp: manager, reason };
    escalations.push({ fromEmployeeId: manager._id, fromName: fullName(manager), toEmployeeId: null, toName: 'HR (no manager available)', reason });
    current = manager.managerId ?? null;
  }
  return { manager: null, escalations };
};

/* ------------------------------- Dispatch ------------------------------- */

export interface DispatchInput {
  organizationId: Id;
  event: NotificationEvent;
  actor?: { userId?: Id | null; name?: string | null } | null;
  vars: Vars;
  /** App path (e.g. /leave/requests/…) for the in-app link and the email button. */
  link: string;
  entityType: string;
  entityId: Id;
  /** Leave: the employee the request is for. */
  employeeId?: Id | null;
  /** Interviews. */
  interview?: { interviewerIds: Id[]; jobId?: Id | null };
  candidate?: { name: string; email?: string | null };
  /** People who must act on it (e.g. HR approvers of the current approval step): always told. */
  approverUserIds?: Id[];
  /** The reporting manager approves this step: always told (with escalation), whatever the rule's recipients. */
  managerApproves?: boolean;
}

const ROLE_ORDER: Person['role'][] = ['EMPLOYEE', 'CANDIDATE', 'MANAGER', 'APPROVER', 'INTERVIEWERS', 'HIRING_MANAGER', 'RECRUITERS', 'HR', 'ADMIN'];
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Who gets it, given the rule (deduplicated: everyone once, under their most specific role). */
const resolveRecipients = async (input: DispatchInput, rule: NotificationRule) => {
  const { organizationId } = input;
  const wanted = new Set(rule.recipients);
  if (input.managerApproves) wanted.add('MANAGER');
  const people: Person[] = [];
  let escalations: Awaited<ReturnType<typeof resolveManager>>['escalations'] = [];
  let managerName = '';

  const employee = input.employeeId ? (await loadEmployees(organizationId, [input.employeeId]))[0] : undefined;
  if (employee && wanted.has('EMPLOYEE')) people.push(...(await peopleForEmployees(organizationId, [employee], 'EMPLOYEE')));
  if (employee && (wanted.has('MANAGER') || input.approverUserIds)) {
    const resolved = await resolveManager(organizationId, employee, rule.escalate);
    escalations = resolved.escalations;
    managerName = resolved.manager?.name ?? '';
    if (resolved.manager && wanted.has('MANAGER')) people.push(resolved.manager);
  }
  if (input.approverUserIds?.length) people.push(...(await peopleForUserIds(organizationId, input.approverUserIds, 'APPROVER')));
  if (input.candidate && wanted.has('CANDIDATE') && input.candidate.email) {
    people.push({ role: 'CANDIDATE', userId: null, employeeId: null, name: input.candidate.name, email: input.candidate.email });
  }
  if (input.interview) {
    if (wanted.has('INTERVIEWERS')) people.push(...(await peopleForEmployees(organizationId, await loadEmployees(organizationId, input.interview.interviewerIds), 'INTERVIEWERS')));
    const job = input.interview.jobId
      ? await JobOpeningModel.findOne({ _id: input.interview.jobId, organizationId }).select('hiringManagerId createdBy').lean()
      : null;
    if (job?.hiringManagerId && wanted.has('HIRING_MANAGER')) {
      people.push(...(await peopleForEmployees(organizationId, await loadEmployees(organizationId, [job.hiringManagerId as Id]), 'HIRING_MANAGER')));
    }
    if (wanted.has('RECRUITERS')) {
      people.push(...(await usersWithRoles(organizationId, ['recruiter'], 'RECRUITERS')));
      if (job?.createdBy) people.push(...(await peopleForUserIds(organizationId, [job.createdBy as Id], 'RECRUITERS')));
    }
  }
  // No reporting manager reachable at all: HR picks it up (they also get it in CC).
  const noManager = !!employee && wanted.has('MANAGER') && !managerName;
  const hr = wanted.has('HR') || rule.ccHr || noManager ? await usersWithRoles(organizationId, ['hr_admin', 'hr_manager'], 'HR') : [];
  if (wanted.has('HR') || noManager) people.push(...hr);
  if (wanted.has('ADMIN')) people.push(...(await usersWithRoles(organizationId, ['super_admin', 'admin'], 'ADMIN')));

  // Deduplicate by account / email, keeping the most specific role.
  people.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const seen = new Set<string>();
  const unique = people.filter((p) => {
    const keys = [p.userId ? `u:${p.userId}` : null, p.email ? `e:${p.email.toLowerCase()}` : null].filter(Boolean) as string[];
    if (!keys.length || keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
  return { people: unique, hr, escalations, managerName, noManager };
};

/**
 * Sends one event's notifications per the organization's rules and records them. Returns the log id (or null when
 * it could not even be recorded). Never throws.
 */
export const dispatchNotification = async (input: DispatchInput): Promise<Id | null> => {
  const info = NOTIFICATION_EVENT_INFO[input.event];
  const actorId = input.actor?.userId ? String(input.actor.userId) : null;
  try {
    const [rules, org] = await Promise.all([getNotificationRules(input.organizationId), OrganizationModel.findById(input.organizationId).select('name').lean()]);
    const rule = rules[input.event];
    const organization = org?.name ?? '';
    const base = { organizationId: input.organizationId, event: input.event, entityType: input.entityType, entityId: input.entityId, actorId: input.actor?.userId ?? null, actorName: input.actor?.name ?? null };
    if (!rule.enabled || (!rule.inApp && !rule.email)) {
      return (await NotificationDispatchModel.create({ ...base, outcome: 'DISABLED', title: info.label }))._id;
    }

    const { people, hr, escalations, managerName, noManager } = await resolveRecipients(input, rule);
    const vars: Vars = { organization, managerName, actorName: input.actor?.name ?? 'Stencil HRMS', ...input.vars, link: appUrl(input.link) };
    const teamTitle = clean(fillPlaceholders(rule.subject, vars));
    const selfTitle = clean(fillPlaceholders(rule.selfSubject, vars));
    let teamBody = fillPlaceholders(rule.body, vars);
    const selfBody = fillPlaceholders(rule.selfBody, vars);
    if (escalations.length) {
      const last = escalations[escalations.length - 1]!;
      teamBody += `\n\nEscalated: ${escalations.map((e) => `${e.fromName} ${e.reason}`).join('; ')} — sent to ${last.toEmployeeId ? last.toName : 'HR'} instead.`;
    }

    // Who's skipped (performed the action themselves, nothing to reach them on).
    const records = people.map((p) => ({
      role: p.role,
      userId: p.userId,
      employeeId: p.employeeId,
      name: p.name,
      email: p.email,
      inApp: false,
      emailAs: null as 'TO' | 'CC' | null,
      skipped: actorId && p.userId && String(p.userId) === actorId ? 'performed the action' : !p.userId && !p.email ? 'no account or email' : null,
    }));
    const active = records.filter((r) => !r.skipped);
    const isSelf = (r: (typeof records)[number]) => (SELF_RECIPIENTS as string[]).includes(r.role);

    // In-app + push (people with an account).
    if (rule.inApp) {
      for (const [group, title, body] of [
        [active.filter((r) => !isSelf(r) && r.userId), teamTitle, teamBody],
        [active.filter((r) => isSelf(r) && r.userId), selfTitle, selfBody],
      ] as const) {
        if (!group.length) continue;
        await notify({
          organizationId: input.organizationId,
          userIds: group.map((r) => r.userId!),
          type: info.type,
          title,
          message: clean(body).slice(0, 600),
          link: input.link,
          entityType: input.entityType,
          entityId: input.entityId,
          skipEmail: true,
        });
        group.forEach((r) => (r.inApp = true));
      }
    }

    // Emails: one to the team (HR in CC for leave), one to the person it's about.
    const dispatch = await NotificationDispatchModel.create({ ...base, title: teamTitle || selfTitle, escalations });
    const emailLogIds: Id[] = [];
    if (rule.email) {
      const hrEmails = rule.ccHr
        ? hr.filter((h) => h.email && (!actorId || String(h.userId) !== actorId)).map((h) => h.email!.toLowerCase())
        : [];
      const team = active.filter((r) => !isSelf(r) && r.email && !(rule.ccHr && r.role === 'HR'));
      const self = active.filter((r) => isSelf(r) && r.email);
      let cc = hrEmails.filter((e) => !team.some((t) => t.email!.toLowerCase() === e));
      // Only HR to tell (no one else on the team): they get it directly rather than in CC.
      if (!team.length && !self.length && cc.length) {
        team.push(...active.filter((r) => r.role === 'HR' && r.email));
        if (!team.length) team.push(...hr.filter((h) => h.email && cc.includes(h.email.toLowerCase())).map((h) => ({ ...h, inApp: false, emailAs: null as 'TO' | 'CC' | null, skipped: null })));
        cc = [];
      }
      const ccFor = (to: typeof team) => (to.length ? cc : []);
      if (team.length) {
        const id = await sendRenderedEmail({
          to: team.map((r) => r.email!),
          cc: ccFor(team),
          template: `auto:${input.event}`,
          rendered: renderBranded({ title: teamTitle, body: teamBody, link: input.link, organization }),
          organizationId: input.organizationId,
          dispatchId: dispatch._id,
        });
        if (id) emailLogIds.push(id);
        team.forEach((t) => {
          const rec = records.find((r) => r.email && r.email.toLowerCase() === t.email!.toLowerCase());
          if (rec) rec.emailAs = 'TO';
          else records.push({ ...t, role: 'HR', inApp: false, emailAs: 'TO', skipped: null } as (typeof records)[number]);
        });
      }
      if (self.length) {
        // HR is copied once: on the team email when there is one, otherwise on this one.
        const selfCc = team.length ? [] : cc;
        const id = await sendRenderedEmail({
          to: self.map((r) => r.email!),
          cc: selfCc,
          template: `auto:${input.event}:self`,
          rendered: renderBranded({ title: selfTitle, body: selfBody, link: input.candidate ? undefined : input.link, organization }),
          organizationId: input.organizationId,
          dispatchId: dispatch._id,
        });
        if (id) emailLogIds.push(id);
        self.forEach((s) => (s.emailAs = 'TO'));
      }
      if ((team.length || self.length) && cc.length) {
        for (const e of cc) {
          const rec = records.find((r) => r.email?.toLowerCase() === e);
          if (rec) {
            if (!rec.emailAs) rec.emailAs = 'CC';
          } else {
            const h = hr.find((x) => x.email?.toLowerCase() === e)!;
            records.push({ role: 'HR', userId: h.userId, employeeId: h.employeeId, name: h.name, email: h.email, inApp: false, emailAs: 'CC', skipped: null });
          }
        }
      }
    }
    const delivered = records.some((r) => r.inApp || r.emailAs);
    await NotificationDispatchModel.updateOne(
      { _id: dispatch._id },
      { recipients: records, emailLogIds, outcome: delivered ? 'SENT' : 'NO_RECIPIENTS', ...(noManager && !escalations.length ? { error: 'The employee has no reporting manager; HR was told instead.' } : {}) },
    );
    return dispatch._id;
  } catch (err) {
    logger.error({ err, event: input.event, entityId: String(input.entityId) }, 'Automated notification failed');
    try {
      return (
        await NotificationDispatchModel.create({
          organizationId: input.organizationId,
          event: input.event,
          entityType: input.entityType,
          entityId: input.entityId,
          actorId: input.actor?.userId ?? null,
          actorName: input.actor?.name ?? null,
          title: info.label,
          outcome: 'ERROR',
          error: (err as Error).message,
        })
      )._id;
    } catch {
      return null;
    }
  }
};

/** The id helper used by callers holding string ids. */
export const oid = (id: string | Id) => (typeof id === 'string' ? new Types.ObjectId(id) : id);
