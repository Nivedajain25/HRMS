import type { Request } from 'express';
import { z } from 'zod';
import { NOTIFICATION_EVENTS, idParam, notificationPreviewSchema, notificationRulesUpdateSchema } from '@stencil/shared';
import { body, query } from '../middleware/validate';
import * as admin from '../services/notification-admin.service';
import { handle, handlePaged, idOf } from '../utils/controller';
import { createModule } from './registry';

/** Automated HR notifications: rules and templates (HR / Admin with settings:manage). */
export const notificationSettingsModule = createModule('Notification rules', '/api/v1/notification-settings');

notificationSettingsModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'Automated notification rules',
    description:
      'Every automated event (leave requested / approved / rejected / cancelled / changed, interview scheduled / rescheduled / cancelled / result) with its label, allowed recipients, placeholders and defaults, plus the organization’s effective `rules` and which events are `customized`.',
    permissions: ['settings:manage'],
  },
  handle((ctx) => admin.getNotificationSettings(ctx)),
);
notificationSettingsModule.route(
  {
    method: 'put',
    path: '/',
    summary: 'Save automated notification rules',
    description:
      'Partial: `rules.<EVENT>` merges into the saved rule (on/off, in-app, email, recipients, CC HR, escalation, subject/body templates); `null` restores the defaults. Templates are plain text with `{{placeholders}}` and are HTML-escaped when sent. Audited.',
    permissions: ['settings:manage'],
    body: notificationRulesUpdateSchema,
  },
  handle((ctx, req: Request) => admin.updateNotificationSettings(ctx, body(req)), 'Notification rules saved'),
);
notificationSettingsModule.route(
  {
    method: 'post',
    path: '/preview',
    summary: 'Preview a notification email (optionally send a test to yourself)',
    description: 'Renders the event’s team or self email with sample data, applying unsaved edits in `rule`. With `sendTest`, emails it to the caller.',
    permissions: ['settings:manage'],
    body: notificationPreviewSchema,
  },
  handle((ctx, req: Request) => admin.previewNotification(ctx, body(req))),
);

/** Delivery log of automated notifications (who, how, delivery status, escalations). */
export const notificationLogModule = createModule('Notification log', '/api/v1/notification-log');

const logQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  event: z.enum(NOTIFICATION_EVENTS).optional(),
  status: z.enum(['SENT', 'FAILED', 'PENDING', 'ESCALATED', 'NO_RECIPIENTS', 'DISABLED', 'ERROR']).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

notificationLogModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'Automated notification log',
    description:
      'Newest first: event, entity, who triggered it, recipients (role, in-app, email To/CC, skipped and why), escalations past unavailable managers, and the email delivery summary (`SENT`, `PENDING`, `FAILED`, `PARTIAL`, `NOT_CONFIGURED`, `NONE`). Filter by `event`, `status` (`FAILED`, `PENDING`, `ESCALATED`, `NO_RECIPIENTS`, `DISABLED`, `ERROR`), text `q` and date range. Requires `audit:read`.',
    permissions: ['audit:read'],
    query: logQuery,
  },
  handlePaged((ctx, req: Request) => admin.listNotificationLog(ctx, query(req) ?? {})),
);
notificationLogModule.route(
  { method: 'get', path: '/:id', summary: 'One notification with its emails (to, cc, status, attempts, errors)', permissions: ['audit:read'], params: idParam },
  handle((ctx, req: Request) => admin.getNotificationLogEntry(ctx, idOf(req))),
);
notificationLogModule.route(
  {
    method: 'post',
    path: '/emails/:id/retry',
    summary: 'Re-send a failed notification email exactly as it was rendered',
    permissions: ['audit:read', 'settings:manage'],
    params: idParam,
  },
  handle((ctx, req: Request) => admin.retryNotificationEmail(ctx, idOf(req)), 'Email queued again'),
);
