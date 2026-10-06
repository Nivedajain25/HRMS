import type { Request } from 'express';
import type { announcementSchema, AnnouncementListQuery, AnnouncementUpdateInput, NotificationListQuery, NotificationType } from '@stencil/shared';
import type { z } from 'zod';
import { body, query } from '../middleware/validate';
import * as announcements from '../services/announcement.service';
import * as notifications from '../services/notification-center.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type PrefsBody = { preferences: { type: NotificationType; inApp: boolean; email: boolean }[] };

export const announcementController = {
  list: handlePaged((ctx, req: Request) => announcements.listAnnouncements(ctx, query<AnnouncementListQuery>(req))),
  highlights: handle((ctx) => announcements.announcementHighlights(ctx)),
  get: handle((ctx, req) => announcements.getAnnouncement(ctx, idOf(req))),
  create: handleCreated((ctx, req) => announcements.createAnnouncement(ctx, body<z.output<typeof announcementSchema>>(req)), 'Announcement created'),
  update: handle((ctx, req) => announcements.updateAnnouncement(ctx, idOf(req), body<AnnouncementUpdateInput>(req)), 'Announcement updated'),
  remove: handle((ctx, req) => announcements.deleteAnnouncement(ctx, idOf(req)), 'Announcement deleted'),
  read: handle((ctx, req) => announcements.markAnnouncementRead(ctx, idOf(req))),
  reads: handle((ctx, req) => announcements.announcementReads(ctx, idOf(req))),
};

export const notificationController = {
  list: handlePaged((ctx, req) => notifications.listNotifications(ctx, query<NotificationListQuery>(req))),
  unreadCount: handle((ctx) => notifications.unreadCount(ctx)),
  read: handle((ctx, req) => notifications.markNotificationRead(ctx, idOf(req))),
  readAll: handle((ctx) => notifications.markAllRead(ctx), 'All notifications marked as read'),
  remove: handle((ctx, req) => notifications.deleteNotification(ctx, idOf(req)), 'Notification deleted'),
  preferences: handle((ctx) => notifications.getPreferences(ctx)),
  updatePreferences: handle((ctx, req) => notifications.updatePreferences(ctx, body<PrefsBody>(req)), 'Preferences saved'),
};
