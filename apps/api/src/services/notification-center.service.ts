import { NOTIFICATION_TYPES, type NotificationListQuery, type NotificationType } from '@stencil/shared';
import { NotificationModel, NotificationPreferenceModel } from '../models';
import { NOTIFICATION_READ_TTL_HOURS } from '../models/system.model';
import type { RequestContext } from '../types/context';
import { notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { emailEnabledByDefault } from './notification.service';

const READ_TTL_MS = NOTIFICATION_READ_TTL_HOURS * 3_600_000;
const expiryFrom = (from: Date) => new Date(from.getTime() + READ_TTL_MS);

/**
 * Startup migration: read notifications used to expire through a TTL index on `readAt`, which can't spare
 * starred ones. Drop it, and give already-read, unstarred notifications their `expiresAt`. Idempotent.
 */
export const migrateNotificationExpiry = async () => {
  const indexes = await NotificationModel.collection.indexes().catch(() => []);
  const old = indexes.find((ix) => JSON.stringify(ix.key) === JSON.stringify({ readAt: 1 }) && ix.expireAfterSeconds !== undefined);
  if (old?.name) await NotificationModel.collection.dropIndex(old.name);
  await NotificationModel.updateMany({ readAt: { $ne: null }, starred: { $ne: true }, expiresAt: null }, [
    { $set: { expiresAt: { $add: ['$readAt', READ_TTL_MS] } } },
  ]);
};

/** The signed-in user's own notifications (newest first). */
export const listNotifications = async (ctx: RequestContext, q: NotificationListQuery) => {
  const filter = {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    ...(q.unread ? { readAt: null } : {}),
    ...(q.starred ? { starred: true } : {}),
  };
  const [items, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    NotificationModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

export const unreadCount = async (ctx: RequestContext) => ({
  count: await NotificationModel.countDocuments({ organizationId: ctx.organizationId, userId: ctx.userId, readAt: null }),
});

export const markNotificationRead = async (ctx: RequestContext, id: string) => {
  const n = await NotificationModel.findOne({ _id: id, organizationId: ctx.organizationId, userId: ctx.userId });
  if (!n) throw notFound('Notification');
  if (!n.readAt) {
    n.readAt = new Date();
    // Deleted 12 hours after it's read, unless it's starred.
    if (!n.starred) n.expiresAt = expiryFrom(n.readAt);
    await n.save();
  }
  return n.toJSON();
};

export const markAllRead = async (ctx: RequestContext) => {
  const now = new Date();
  const own = { organizationId: ctx.organizationId, userId: ctx.userId, readAt: null };
  const [plain, starred] = await Promise.all([
    NotificationModel.updateMany({ ...own, starred: { $ne: true } }, { readAt: now, expiresAt: expiryFrom(now) }),
    NotificationModel.updateMany({ ...own, starred: true }, { readAt: now }),
  ]);
  return { updated: plain.modifiedCount + starred.modifiedCount };
};

/**
 * Star (keep) or unstar one of the signed-in user's own notifications. Starred ones are never auto-deleted; a read
 * notification that's unstarred gets a fresh 12 hours.
 */
export const starNotification = async (ctx: RequestContext, id: string, starred: boolean) => {
  const n = await NotificationModel.findOne({ _id: id, organizationId: ctx.organizationId, userId: ctx.userId });
  if (!n) throw notFound('Notification');
  n.starred = starred;
  n.expiresAt = starred || !n.readAt ? null : expiryFrom(new Date());
  await n.save();
  return n.toJSON();
};

export const deleteNotification = async (ctx: RequestContext, id: string) => {
  const res = await NotificationModel.deleteOne({ _id: id, organizationId: ctx.organizationId, userId: ctx.userId });
  if (!res.deletedCount) throw notFound('Notification');
};

interface Pref {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
}

/** Every notification type with the user's choice or the default (in-app on; email per type). */
export const getPreferences = async (ctx: RequestContext): Promise<Pref[]> => {
  const doc = await NotificationPreferenceModel.findOne({ organizationId: ctx.organizationId, userId: ctx.userId }).lean();
  const stored = new Map((doc?.preferences ?? []).map((p) => [p.type, p]));
  // Emergency alerts are always delivered on every channel, so they aren't a preference.
  return NOTIFICATION_TYPES.filter((type) => type !== 'EMERGENCY').map((type) => {
    const p = stored.get(type);
    return {
      type,
      inApp: p?.inApp ?? true,
      email: p?.email ?? emailEnabledByDefault(type),
    };
  });
};

export const updatePreferences = async (ctx: RequestContext, input: { preferences: Pref[] }) => {
  const current = await getPreferences(ctx);
  const updates = new Map(input.preferences.map((p) => [p.type, p]));
  const merged = current.map((p) => updates.get(p.type) ?? p);
  await NotificationPreferenceModel.updateOne(
    { userId: ctx.userId },
    { $set: { organizationId: ctx.organizationId, userId: ctx.userId, preferences: merged } },
    { upsert: true },
  );
  return getPreferences(ctx);
};
