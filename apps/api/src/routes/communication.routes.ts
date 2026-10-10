import {
  announcementListQuery,
  announcementSchema,
  announcementUpdateSchema,
  idParam,
  notificationListQuery,
  notificationPreferencesSchema,
  notificationStarSchema,
} from '@stencil/shared';
import { announcementController as ann, notificationController as notif } from '../controllers/communication.controller';
import { createModule } from './registry';

// Scheduled jobs for this module (announcements.publish, reminders.*) live in
// jobs/reminders.ts and are registered through jobs/all.ts (registerAllJobs).

export const announcementModule = createModule('Announcements', '/api/v1/announcements');
announcementModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List announcements',
    description:
      'Default: published, non-expired announcements targeted at the caller (ALL / their department / them), pinned first, each with `read` and `canEdit`. `scope=all` includes scheduled/expired ones with `status` and `readCount`: every announcement for `announcement:manage`, otherwise the caller’s own.',
    query: announcementListQuery,
  },
  ann.list,
);
// Registered before '/:id' so "highlights" is not taken for an id.
announcementModule.route(
  {
    method: 'get',
    path: '/highlights',
    summary: 'Announcements to pop up and to keep pinned at the top of the app',
    description:
      '`popup`: unread announcements from the last 14 days (not the caller’s own), most urgent first — shown once, then marked read with `POST /:id/read`. `bar`: pinned announcements (until they expire) and those published in the last 7 days, pinned first.',
  },
  ann.highlights,
);
announcementModule.route({ method: 'get', path: '/:id', summary: 'Get an announcement', params: idParam }, ann.get);
announcementModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Create an announcement',
    description:
      'Anyone signed in can post. HTML content is sanitized server-side (allowlist). Published immediately unless `publishAt` is in the future; the audience is notified on publish (in-app and push, and emailed when `sendEmail`).',
    body: announcementSchema,
  },
  ann.create,
);
announcementModule.route(
  { method: 'patch', path: '/:id', summary: 'Update an announcement (its author, or `announcement:manage`)', params: idParam, body: announcementUpdateSchema },
  ann.update,
);
announcementModule.route({ method: 'delete', path: '/:id', summary: 'Delete an announcement (its author, or `announcement:manage`)', params: idParam }, ann.remove);
announcementModule.route({ method: 'post', path: '/:id/read', summary: 'Mark an announcement as read (idempotent)', params: idParam }, ann.read);
announcementModule.route(
  { method: 'get', path: '/:id/reads', summary: 'Read tracking (read / targeted users): the author, or `announcement:manage`', params: idParam },
  ann.reads,
);

export const notificationModule = createModule('Notifications', '/api/v1/notifications');
notificationModule.route({ method: 'get', path: '/', summary: 'My notifications (newest first)', query: notificationListQuery }, notif.list);
notificationModule.route({ method: 'get', path: '/unread-count', summary: 'My unread notification count' }, notif.unreadCount);
notificationModule.route({ method: 'get', path: '/preferences', summary: 'My notification preferences (all types, merged with defaults)' }, notif.preferences);
notificationModule.route(
  { method: 'put', path: '/preferences', summary: 'Update my notification preferences', body: notificationPreferencesSchema },
  notif.updatePreferences,
);
notificationModule.route({ method: 'post', path: '/read-all', summary: 'Mark all my notifications as read' }, notif.readAll);
notificationModule.route({ method: 'post', path: '/:id/read', summary: 'Mark a notification as read', params: idParam }, notif.read);
notificationModule.route(
  { method: 'post', path: '/:id/star', summary: 'Star (keep) or unstar one of my notifications; starred ones are not auto-deleted', params: idParam, body: notificationStarSchema },
  notif.star,
);
notificationModule.route({ method: 'delete', path: '/:id', summary: 'Delete one of my notifications', params: idParam }, notif.remove);
