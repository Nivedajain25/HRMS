import { Types } from 'mongoose';
import type { REMINDER_COLORS } from '@stencil/shared';
import { logger } from '../config/logger';
import { OrganizationModel, ReminderModel } from '../models';
import type { RequestContext } from '../types/context';
import { zonedInstant } from '../utils/dates';
import { notFound } from '../utils/errors';
import { notify } from './notification.service';

type Color = (typeof REMINDER_COLORS)[number];
type Input = { title: string; note?: string; date: string; time?: string | null; color?: Color };

const mine = (ctx: RequestContext) => ({ organizationId: ctx.organizationId, userId: ctx.userId });

const orgTimezone = async (organizationId: Types.ObjectId) =>
  (await OrganizationModel.findById(organizationId).select('timezone').lean())?.timezone ?? 'Asia/Kolkata';

/** When to ping: the date at the given time (org timezone), or 09:00 for all-day reminders. */
const remindAtFor = (date: string, time: string | null | undefined, timeZone: string) => zonedInstant(date, time || '09:00', timeZone);

/** My reminders between two days (inclusive), in date/time order. */
export const listReminders = (ctx: RequestContext, q: { from: string; to: string }) =>
  ReminderModel.find({ ...mine(ctx), date: { $gte: q.from, $lte: q.to } }).sort({ date: 1, time: 1, createdAt: 1 }).lean();

export const createReminder = async (ctx: RequestContext, input: Input) => {
  const tz = await orgTimezone(ctx.organizationId);
  const remindAt = remindAtFor(input.date, input.time, tz);
  const doc = await ReminderModel.create({
    ...mine(ctx),
    title: input.title,
    note: input.note || undefined,
    date: input.date,
    time: input.time || null,
    color: input.color ?? 'blue',
    remindAt,
    // A reminder set for a moment already past is not sent (it just sits on the calendar).
    notifiedAt: remindAt.getTime() < Date.now() - 60_000 ? new Date() : null,
  });
  return doc.toObject();
};

export const updateReminder = async (ctx: RequestContext, id: string, input: Partial<Input>) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reminder');
  const doc = await ReminderModel.findOne({ _id: id, ...mine(ctx) });
  if (!doc) throw notFound('Reminder');
  if (input.title !== undefined) doc.title = input.title;
  if (input.note !== undefined) doc.note = input.note || undefined;
  if (input.color !== undefined) doc.color = input.color;
  if (input.date !== undefined || input.time !== undefined) {
    if (input.date !== undefined) doc.date = input.date;
    if (input.time !== undefined) doc.time = input.time || null;
    doc.remindAt = remindAtFor(doc.date, doc.time, await orgTimezone(ctx.organizationId));
    // Moved to a new moment: remind again (unless that moment has already passed).
    doc.notifiedAt = doc.remindAt.getTime() < Date.now() - 60_000 ? new Date() : null;
  }
  await doc.save();
  return doc.toObject();
};

export const deleteReminder = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Reminder');
  const res = await ReminderModel.deleteOne({ _id: id, ...mine(ctx) });
  if (!res.deletedCount) throw notFound('Reminder');
  return { deleted: true };
};

/** Scheduled every minute: sends each due reminder once (in-app + push, even if notifications are muted). */
export const sendDueReminders = async () => {
  const due = await ReminderModel.find({ notifiedAt: null, remindAt: { $lte: new Date() } }).limit(200).lean();
  for (const r of due) {
    // Claim it first so two workers never send the same reminder twice.
    const claimed = await ReminderModel.updateOne({ _id: r._id, notifiedAt: null }, { notifiedAt: new Date() });
    if (!claimed.modifiedCount) continue;
    try {
      await notify({
        organizationId: r.organizationId,
        userIds: [r.userId],
        type: 'GENERAL',
        title: `⏰ Reminder: ${r.title}`,
        message: r.note || (r.time ? `Today at ${r.time}` : 'Today'),
        link: '/?view=me',
        entityType: 'Reminder',
        entityId: r._id,
        force: true,
      });
    } catch (err) {
      logger.error({ err, reminderId: String(r._id) }, 'Failed to send reminder');
    }
  }
  return due.length;
};
