import { Types, type FilterQuery, type Model } from 'mongoose';
import type { AnnouncementListQuery, AnnouncementUpdateInput, announcementSchema } from '@stencil/shared';
import type { z } from 'zod';
import { logger } from '../config/logger';
import {
  AnnouncementModel,
  AnnouncementReadModel,
  DepartmentModel,
  DocumentModel,
  EmployeeModel,
  OrganizationModel,
  UserModel,
  type Announcement,
} from '../models';
import { addDaysKey, dateKeyInTz, zonedInstant } from '../utils/dates';
import { can, type RequestContext } from '../types/context';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { buildPagination, escapeRegex } from '../utils/pagination';
import { excerpt, htmlToText, sanitizeHtml } from '../utils/sanitize-html';
import { audit, diff } from './audit.service';
import { sendEmail } from './email.service';
import { notify } from './notification.service';
import { assertIdsInOrg } from './refs.service';

type CreateInput = z.output<typeof announcementSchema>;
type AnnouncementLean = Announcement & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

const ATTACHMENT_POPULATE = { path: 'attachmentIds', select: 'title originalName mimeType size' };
const AUTHOR_POPULATE = { path: 'createdBy', select: 'firstName lastName avatar' };

const orgTimeZone = async (organizationId: Types.ObjectId) =>
  (await OrganizationModel.findById(organizationId).select('timezone').lean())?.timezone || 'UTC';

/** 12:00 AM after the day `from` falls on, in the organization's timezone. */
export const nextMidnight = (from: Date, timeZone: string) => zonedInstant(addDaysKey(dateKeyInTz(from, timeZone), 1), '00:00', timeZone);

/**
 * When an announcement comes down: its own end time, or — without one (it's the default) — 12:00 AM the night after
 * the day it was published, so a day's wishes and notices don't linger.
 */
const endOf = (a: Pick<Announcement, 'publishAt' | 'expiresAt'>, timeZone: string) =>
  a.expiresAt ?? (a.publishAt ? nextMidnight(a.publishAt, timeZone) : null);

const statusOf = (a: Pick<Announcement, 'publishAt' | 'expiresAt'>, timeZone: string, now = new Date()) => {
  if (a.publishAt && a.publishAt > now) return 'SCHEDULED' as const;
  const end = endOf(a, timeZone);
  if (end && end <= now) return 'EXPIRED' as const;
  return 'PUBLISHED' as const;
};

/** The viewer's department (for DEPARTMENTS-targeted announcements). */
const viewerDepartment = async (ctx: RequestContext) => {
  if (!ctx.employeeId) return null;
  const emp = await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId }).select('departmentId').lean();
  return emp?.departmentId ?? null;
};

/**
 * Filter for announcements visible to the current user: published, not
 * expired, not deleted and targeted at everyone / their department / them.
 */
export const visibleFilter = async (ctx: RequestContext, now = new Date()): Promise<FilterQuery<Announcement>> => {
  const [departmentId, timeZone] = await Promise.all([viewerDepartment(ctx), orgTimeZone(ctx.organizationId)]);
  const audience: Record<string, unknown>[] = [{ audience: 'ALL' }];
  if (departmentId) audience.push({ audience: 'DEPARTMENTS', departmentIds: departmentId });
  if (ctx.employeeId) audience.push({ audience: 'EMPLOYEES', employeeIds: ctx.employeeId });
  // No end time → only until 12:00 AM after its day, i.e. visible while it was published today.
  const startOfToday = zonedInstant(dateKeyInTz(now, timeZone), '00:00', timeZone);
  return {
    organizationId: ctx.organizationId,
    deletedAt: null,
    publishAt: { $lte: now },
    $and: [{ $or: [{ expiresAt: { $gt: now } }, { expiresAt: null, publishAt: { $gte: startOfToday } }] }, { $or: audience }],
  };
};

const readSet = async (ctx: RequestContext, ids: Types.ObjectId[]) => {
  if (!ids.length) return new Set<string>();
  const reads = await AnnouncementReadModel.find({ organizationId: ctx.organizationId, userId: ctx.userId, announcementId: { $in: ids } })
    .select('announcementId')
    .lean();
  return new Set(reads.map((r) => String(r.announcementId)));
};

const validateRefs = async (
  ctx: RequestContext,
  input: { departmentIds?: string[]; employeeIds?: string[]; attachmentIds?: string[] },
) => {
  await assertIdsInOrg(ctx.organizationId, DepartmentModel as unknown as Model<never>, input.departmentIds ?? [], 'departments');
  await assertIdsInOrg(ctx.organizationId, EmployeeModel as unknown as Model<never>, input.employeeIds ?? [], 'employees');
  if (input.attachmentIds?.length) {
    const unique = [...new Set(input.attachmentIds)];
    const count = await DocumentModel.countDocuments({ _id: { $in: unique }, organizationId: ctx.organizationId, deletedAt: null });
    if (count !== unique.length) throw badRequest('One or more attachments were not found', 'INVALID_REFERENCE');
  }
};

const cleanContent = (html: string) => {
  const content = sanitizeHtml(html);
  if (!htmlToText(content)) throw badRequest('Content is required', 'VALIDATION_ERROR', [{ path: 'content', message: 'Content is required' }]);
  return content;
};

const assertDates = (publishAt: Date, expiresAt: Date | null) => {
  if (expiresAt && expiresAt <= publishAt) {
    throw badRequest('Expiry must be after the publish time', 'VALIDATION_ERROR', [{ path: 'expiresAt', message: 'Expiry must be after the publish time' }]);
  }
};

/* ----------------------------- Publishing ----------------------------- */

/** User ids of active accounts targeted by an announcement. */
export const targetedUserIds = async (a: Pick<AnnouncementLean, 'organizationId' | 'audience' | 'departmentIds' | 'employeeIds'>) => {
  const organizationId = a.organizationId;
  if (a.audience === 'ALL') {
    const users = await UserModel.find({ organizationId, status: 'ACTIVE' }).select('_id').lean();
    return users.map((u) => u._id);
  }
  const empFilter =
    a.audience === 'DEPARTMENTS'
      ? { organizationId, departmentId: { $in: a.departmentIds ?? [] }, deletedAt: null }
      : { organizationId, _id: { $in: a.employeeIds ?? [] }, deletedAt: null };
  const employees = await EmployeeModel.find(empFilter).select('_id').lean();
  if (!employees.length) return [];
  const users = await UserModel.find({ organizationId, status: 'ACTIVE', employeeId: { $in: employees.map((e) => e._id) } })
    .select('_id')
    .lean();
  return users.map((u) => u._id);
};

/**
 * Notifies the audience of a due announcement exactly once. The `notifiedAt`
 * claim is atomic, so concurrent publishers (API + scheduled job) never
 * double-notify.
 */
export const publishAnnouncement = async (announcementId: Types.ObjectId) => {
  const now = new Date();
  const a = await AnnouncementModel.findOneAndUpdate(
    { _id: announcementId, notifiedAt: null, deletedAt: null, publishAt: { $lte: now } },
    { notifiedAt: now },
    { new: true },
  ).lean();
  if (!a) return false;
  if (a.expiresAt && a.expiresAt <= now) return false;

  const userIds = (await targetedUserIds(a)).filter((id) => !id.equals(a.createdBy));
  await notify({
    organizationId: a.organizationId,
    userIds,
    type: 'ANNOUNCEMENT',
    title: a.title,
    message: excerpt(a.content, 160),
    link: `/announcements/${a._id}`,
    entityType: 'Announcement',
    entityId: a._id,
    // With `sendEmail`, everyone gets the dedicated announcement email below
    // instead of the generic notification email (never both).
    skipEmail: !!a.sendEmail,
  });

  if (a.sendEmail && userIds.length) {
    const users = await UserModel.find({ _id: { $in: userIds }, organizationId: a.organizationId, status: 'ACTIVE' }).select('email firstName').lean();
    const text = excerpt(a.content, 200);
    for (const u of users) {
      await sendEmail(u.email, 'announcement', { name: u.firstName, title: a.title, excerpt: text }, a.organizationId);
    }
  }
  return true;
};

/** Scheduled sweep: publishes every due announcement not yet notified. */
export const publishDueAnnouncements = async () => {
  const now = new Date();
  const due = await AnnouncementModel.find({ notifiedAt: null, deletedAt: null, publishAt: { $lte: now } })
    .select('_id')
    .sort({ publishAt: 1 })
    .limit(200)
    .lean();
  let published = 0;
  for (const a of due) {
    try {
      if (await publishAnnouncement(a._id)) published++;
    } catch (err) {
      logger.error({ err, announcementId: String(a._id) }, 'Failed to publish announcement');
    }
  }
  return { published };
};

/* ------------------------------- Queries ------------------------------ */

export const listAnnouncements = async (ctx: RequestContext, q: AnnouncementListQuery) => {
  const manage = q.scope === 'all';
  if (manage && !can(ctx, 'announcement:manage')) throw forbidden();
  const filter: FilterQuery<Announcement> = manage ? { organizationId: ctx.organizationId, deletedAt: null } : await visibleFilter(ctx);
  if (q.search) filter.title = new RegExp(escapeRegex(q.search), 'i');
  if (q.priority) filter.priority = q.priority;

  const [items, total] = await Promise.all([
    AnnouncementModel.find(filter)
      .sort({ pinned: -1, publishAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(AUTHOR_POPULATE)
      .populate(ATTACHMENT_POPULATE)
      .lean(),
    AnnouncementModel.countDocuments(filter),
  ]);
  const ids = items.map((i) => i._id);
  const [read, timeZone] = await Promise.all([readSet(ctx, ids), orgTimeZone(ctx.organizationId)]);
  let readCounts = new Map<string, number>();
  if (manage && ids.length) {
    const agg = await AnnouncementReadModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { organizationId: ctx.organizationId, announcementId: { $in: ids } } },
      { $group: { _id: '$announcementId', count: { $sum: 1 } } },
    ]);
    readCounts = new Map(agg.map((r) => [String(r._id), r.count]));
  }
  return {
    items: items.map((a) => ({
      ...a,
      expiresAt: endOf(a, timeZone),
      status: statusOf(a, timeZone),
      read: read.has(String(a._id)),
      ...(manage ? { readCount: readCounts.get(String(a._id)) ?? 0 } : {}),
    })),
    pagination: buildPagination(q.page, q.limit, total),
  };
};

/** Latest visible announcements for dashboards. */
export const latestVisible = async (ctx: RequestContext, limit = 5) => {
  const items = await AnnouncementModel.find(await visibleFilter(ctx))
    .sort({ pinned: -1, publishAt: -1 })
    .limit(limit)
    .select('title content priority pinned publishAt expiresAt audience')
    .lean();
  const read = await readSet(ctx, items.map((i) => i._id));
  return items.map(({ content, ...a }) => ({ ...a, excerpt: excerpt(content, 200), read: read.has(String(a._id)) }));
};

/** Unread announcements older than this never pop up (a new joiner is not flooded with history). */
export const POPUP_WINDOW_DAYS = 14;
/** Non-pinned announcements stay in the top bar this long after publishing; pinned ones until they expire or are unpinned. */
export const BAR_WINDOW_DAYS = 7;
const HIGHLIGHT_LIMIT = 5;
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * What the app shell shows the caller:
 * - `popup`: unread announcements from the last POPUP_WINDOW_DAYS (not their own), most urgent first, then oldest
 *   first so they read in order. Shown once as a pop-up; "Got it" marks them read.
 * - `bar`: announcements kept "pinned" at the top of every page — pinned by HR (until expiry) or published in the
 *   last BAR_WINDOW_DAYS — pinned first, then newest.
 */
export const announcementHighlights = async (ctx: RequestContext) => {
  const now = new Date();
  const filter = await visibleFilter(ctx, now);
  const popupSince = new Date(now.getTime() - POPUP_WINDOW_DAYS * 86_400_000);
  const barSince = new Date(now.getTime() - BAR_WINDOW_DAYS * 86_400_000);
  const items = await AnnouncementModel.find({ ...filter, $or: [{ pinned: true }, { publishAt: { $gte: popupSince } }] })
    .sort({ publishAt: -1 })
    .limit(50)
    .populate(AUTHOR_POPULATE)
    .populate(ATTACHMENT_POPULATE)
    .lean();
  const [read, timeZone] = await Promise.all([readSet(ctx, items.map((i) => i._id)), orgTimeZone(ctx.organizationId)]);
  const shape = (a: (typeof items)[number]) => ({
    ...a,
    excerpt: excerpt(a.content, 160),
    expiresAt: endOf(a, timeZone),
    status: statusOf(a, timeZone, now),
    read: read.has(String(a._id)),
  });
  const mine = (a: (typeof items)[number]) => String((a.createdBy as { _id?: Types.ObjectId } | null)?._id ?? a.createdBy) === String(ctx.userId);

  const popup = items
    .filter((a) => !read.has(String(a._id)) && !mine(a) && a.publishAt >= popupSince)
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || a.publishAt.getTime() - b.publishAt.getTime())
    .slice(0, HIGHLIGHT_LIMIT)
    .map(shape);
  const bar = items
    .filter((a) => a.pinned || a.publishAt >= barSince)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishAt.getTime() - a.publishAt.getTime())
    .slice(0, HIGHLIGHT_LIMIT)
    .map(shape);
  return { popup, bar, unreadTotal: popup.length };
};

const loadForViewer = async (ctx: RequestContext, id: string) => {
  const filter = can(ctx, 'announcement:manage')
    ? { _id: id, organizationId: ctx.organizationId, deletedAt: null }
    : { ...(await visibleFilter(ctx)), _id: new Types.ObjectId(id) };
  const a = await AnnouncementModel.findOne(filter).populate(AUTHOR_POPULATE).populate(ATTACHMENT_POPULATE).lean();
  if (!a) throw notFound('Announcement');
  return a;
};

export const getAnnouncement = async (ctx: RequestContext, id: string) => {
  const a = await loadForViewer(ctx, id);
  const [read, timeZone] = await Promise.all([readSet(ctx, [a._id]), orgTimeZone(ctx.organizationId)]);
  const base = { ...a, expiresAt: endOf(a, timeZone), status: statusOf(a, timeZone), read: read.has(String(a._id)) };
  if (!can(ctx, 'announcement:manage')) return base;
  // Managers editing the announcement get audience names alongside the ids.
  const [departments, employees] = await Promise.all([
    a.departmentIds?.length
      ? DepartmentModel.find({ organizationId: ctx.organizationId, _id: { $in: a.departmentIds } }).select('name code').lean()
      : [],
    a.employeeIds?.length
      ? EmployeeModel.find({ organizationId: ctx.organizationId, _id: { $in: a.employeeIds } }).select('firstName lastName employeeId').lean()
      : [],
  ]);
  return {
    ...base,
    audienceTargets: {
      departments: departments.map((d) => ({ _id: d._id, name: d.name, code: d.code })),
      employees: employees.map((e) => ({ _id: e._id, name: `${e.firstName} ${e.lastName}`, employeeId: e.employeeId })),
    },
  };
};

/* ------------------------------ Mutations ----------------------------- */

export const createAnnouncement = async (ctx: RequestContext, input: CreateInput) => {
  await validateRefs(ctx, input);
  const publishAt = input.publishAt ? new Date(input.publishAt) : new Date();
  // Without a chosen end time it comes down at 12:00 AM after the day it's published.
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : nextMidnight(publishAt, await orgTimeZone(ctx.organizationId));
  assertDates(publishAt, expiresAt);
  const doc = await AnnouncementModel.create({
    organizationId: ctx.organizationId,
    title: input.title,
    content: cleanContent(input.content),
    priority: input.priority,
    audience: input.audience,
    departmentIds: input.audience === 'DEPARTMENTS' ? input.departmentIds : [],
    employeeIds: input.audience === 'EMPLOYEES' ? input.employeeIds : [],
    attachmentIds: input.attachmentIds,
    publishAt,
    expiresAt,
    pinned: input.pinned,
    sendEmail: input.sendEmail,
    createdBy: ctx.userId,
  });
  await audit(ctx, {
    action: 'RECORD_CREATED',
    module: 'announcements',
    recordId: doc._id,
    recordLabel: doc.title,
    newValues: { title: doc.title, audience: doc.audience, priority: doc.priority, publishAt: doc.publishAt },
  });
  if (publishAt <= new Date()) await publishAnnouncement(doc._id);
  return getAnnouncement(ctx, String(doc._id));
};

export const updateAnnouncement = async (ctx: RequestContext, id: string, input: AnnouncementUpdateInput) => {
  const doc = await AnnouncementModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!doc) throw notFound('Announcement');
  const before = doc.toObject() as unknown as Record<string, unknown>;

  const audience = input.audience ?? doc.audience;
  const departmentIds = input.departmentIds ?? doc.departmentIds.map(String);
  const employeeIds = input.employeeIds ?? doc.employeeIds.map(String);
  if (audience === 'DEPARTMENTS' && !departmentIds.length) {
    throw badRequest('Select at least one department', 'VALIDATION_ERROR', [{ path: 'departmentIds', message: 'Select at least one department' }]);
  }
  if (audience === 'EMPLOYEES' && !employeeIds.length) {
    throw badRequest('Select at least one employee', 'VALIDATION_ERROR', [{ path: 'employeeIds', message: 'Select at least one employee' }]);
  }
  await validateRefs(ctx, { departmentIds: input.departmentIds, employeeIds: input.employeeIds, attachmentIds: input.attachmentIds });

  if (input.title !== undefined) doc.title = input.title;
  if (input.content !== undefined) doc.content = cleanContent(input.content);
  if (input.priority !== undefined) doc.priority = input.priority;
  if (input.pinned !== undefined) doc.pinned = input.pinned;
  if (input.sendEmail !== undefined) doc.sendEmail = input.sendEmail;
  if (input.attachmentIds !== undefined) doc.set('attachmentIds', input.attachmentIds);
  doc.audience = audience;
  doc.set('departmentIds', audience === 'DEPARTMENTS' ? departmentIds : []);
  doc.set('employeeIds', audience === 'EMPLOYEES' ? employeeIds : []);
  if (input.publishAt !== undefined) {
    const next = new Date(input.publishAt);
    // Re-scheduling an already-notified announcement into the future re-arms notification.
    if (doc.notifiedAt && next > new Date()) doc.notifiedAt = null;
    doc.publishAt = next;
  }
  if (input.expiresAt !== undefined) {
    doc.expiresAt = input.expiresAt ? new Date(input.expiresAt) : nextMidnight(doc.publishAt ?? new Date(), await orgTimeZone(ctx.organizationId));
  }
  assertDates(doc.publishAt ?? new Date(), doc.expiresAt ?? null);
  await doc.save();

  const changes = diff(before, {
    title: doc.title,
    priority: doc.priority,
    audience: doc.audience,
    departmentIds: doc.departmentIds,
    employeeIds: doc.employeeIds,
    publishAt: doc.publishAt,
    expiresAt: doc.expiresAt,
    pinned: doc.pinned,
    ...(input.content !== undefined ? { content: doc.content } : {}),
  });
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'announcements', recordId: doc._id, recordLabel: doc.title, ...changes });
  if (!doc.notifiedAt && doc.publishAt && doc.publishAt <= new Date()) await publishAnnouncement(doc._id);
  return getAnnouncement(ctx, id);
};

export const deleteAnnouncement = async (ctx: RequestContext, id: string) => {
  const doc = await AnnouncementModel.findOneAndUpdate(
    { _id: id, organizationId: ctx.organizationId, deletedAt: null },
    { deletedAt: new Date() },
    { new: true },
  ).lean();
  if (!doc) throw notFound('Announcement');
  await audit(ctx, { action: 'RECORD_DELETED', module: 'announcements', recordId: doc._id, recordLabel: doc.title });
};

/** Records that the current user read an announcement (idempotent). */
export const markAnnouncementRead = async (ctx: RequestContext, id: string) => {
  const a = await loadForViewer(ctx, id);
  await AnnouncementReadModel.updateOne(
    { announcementId: a._id, userId: ctx.userId },
    { $setOnInsert: { organizationId: ctx.organizationId, announcementId: a._id, userId: ctx.userId, readAt: new Date() } },
    { upsert: true },
  );
  return { read: true };
};

/** Read-tracking statistics for managers. */
export const announcementReads = async (ctx: RequestContext, id: string) => {
  const a = await AnnouncementModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!a) throw notFound('Announcement');
  const targeted = await targetedUserIds(a);
  const targetedSet = new Set(targeted.map(String));
  const reads = await AnnouncementReadModel.find({ organizationId: ctx.organizationId, announcementId: a._id })
    .sort({ readAt: -1 })
    .populate({ path: 'userId', select: 'firstName lastName email avatar' })
    .lean();
  const readerId = (r: (typeof reads)[number]) => String((r.userId as unknown as { _id: Types.ObjectId } | null)?._id ?? r.userId);
  const readByTargeted = reads.filter((r) => targetedSet.has(readerId(r)));
  const total = targeted.length;
  const read = readByTargeted.length;
  return {
    announcementId: a._id,
    // Counts cover the targeted audience only.
    total,
    read,
    unread: Math.max(0, total - read),
    readPercent: total ? Math.round((read / total) * 1000) / 10 : 0,
    // Readers outside the audience (e.g. HR previewing) are listed but flagged, so list and counts reconcile.
    outsideAudience: reads.length - readByTargeted.length,
    readers: reads.slice(0, 500).map((r) => ({ user: r.userId, readAt: r.readAt, inAudience: targetedSet.has(readerId(r)) })),
  };
};
