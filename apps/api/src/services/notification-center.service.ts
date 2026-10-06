import { NOTIFICATION_TYPES, type NotificationListQuery, type NotificationType } from '@stencil/shared';
import { NotificationModel, NotificationPreferenceModel } from '../models';
import type { RequestContext } from '../types/context';
import { notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { emailEnabledByDefault } from './notification.service';

/** The signed-in user's own notifications (newest first). */
export const listNotifications = async (ctx: RequestContext, q: NotificationListQuery) => {
  const filter = { organizationId: ctx.organizationId, userId: ctx.userId, ...(q.unread ? { readAt: null } : {}) };
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
    await n.save();
  }
  return n.toJSON();
};

export const markAllRead = async (ctx: RequestContext) => {
  const res = await NotificationModel.updateMany(
    { organizationId: ctx.organizationId, userId: ctx.userId, readAt: null },
    { readAt: new Date() },
  );
  return { updated: res.modifiedCount };
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
