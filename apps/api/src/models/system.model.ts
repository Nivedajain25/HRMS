import { Schema, model, type InferSchemaType } from 'mongoose';
import { AUDIT_ACTIONS, NOTIFICATION_TYPES } from '@stencil/shared';
import { ref, tenantField } from './plugins';

const notificationSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User', true),
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: String,
    entityType: String,
    entityId: { type: Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
    /** Starred by its owner: kept instead of being deleted after it's read. */
    starred: { type: Boolean, default: false },
    /** When MongoDB deletes it: 12 h after it's read (or unstarred); null while unread or starred. */
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
notificationSchema.index({ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 });
// Keep notifications for one year.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });
/** Read, unstarred notifications are deleted this many hours after they're marked read. */
export const NOTIFICATION_READ_TTL_HOURS = 12;
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type NotificationRecord = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = model('Notification', notificationSchema);

const notificationPreferenceSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User', true),
    preferences: {
      type: [
        {
          _id: false,
          type: { type: String, enum: NOTIFICATION_TYPES },
          inApp: { type: Boolean, default: true },
          email: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, versionKey: false },
);
notificationPreferenceSchema.index({ userId: 1 }, { unique: true });
export const NotificationPreferenceModel = model('NotificationPreference', notificationPreferenceSchema);

/**
 * Append-only audit trail. There is intentionally no API that updates or deletes
 * audit logs; the model rejects updates at the middleware level too.
 */
const auditLogSchema = new Schema(
  {
    ...tenantField,
    userId: ref('User'),
    userName: String,
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    module: { type: String, required: true },
    recordId: { type: Schema.Types.ObjectId, default: null },
    recordLabel: String,
    oldValues: { type: Schema.Types.Mixed, default: null },
    newValues: { type: Schema.Types.Mixed, default: null },
    ipAddress: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
auditLogSchema.index({ organizationId: 1, timestamp: -1 });
auditLogSchema.index({ organizationId: 1, module: 1, recordId: 1 });
auditLogSchema.index({ organizationId: 1, action: 1, timestamp: -1 });
auditLogSchema.index({ organizationId: 1, userId: 1, timestamp: -1 });
const immutable = () => {
  throw new Error('Audit logs are immutable');
};
auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'], immutable);
export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);

/** Atomic per-organization counters (expense numbers, job codes...). */
const counterSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    value: { type: Number, default: 0 },
  },
  { versionKey: false },
);
counterSchema.index({ organizationId: 1, key: 1 }, { unique: true });
export const CounterModel = model('Counter', counterSchema);

/** Outbound email log (delivery tracking and idempotency). */
const emailLogSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, default: null },
    /** Comma-separated To addresses. */
    to: { type: String, required: true },
    cc: { type: [String], default: [] },
    template: { type: String, required: true },
    subject: String,
    /** RETRYING: a send failed and another attempt is scheduled. */
    status: { type: String, enum: ['QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'RETRYING'], default: 'QUEUED' },
    error: String,
    messageId: String,
    sentAt: Date,
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date,
    /** The automated notification this email belongs to (Settings → Notification log). */
    dispatchId: { type: Schema.Types.ObjectId, default: null, index: true },
    /** The rendered email, kept so a failed one can be re-sent as-is (deleted with the log after 90 days). */
    rendered: { type: { subject: String, html: String, text: String }, default: null, select: false },
  },
  { timestamps: true, versionKey: false },
);
emailLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
emailLogSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
export const EmailLogModel = model('EmailLog', emailLogSchema);

/**
 * Audit trail of every automated notification (leave, interviews): the event, who it reached and how (in-app,
 * email To / CC), who was skipped and why, any escalation past an unavailable manager, and the emails sent (whose
 * delivery status lives on their EmailLog rows). Kept for 2 years.
 */
const notificationDispatchSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    event: { type: String, required: true },
    title: String,
    entityType: String,
    entityId: { type: Schema.Types.ObjectId, default: null },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorName: String,
    /** NO_RECIPIENTS / DISABLED: nothing was sent (still recorded). */
    outcome: { type: String, enum: ['SENT', 'NO_RECIPIENTS', 'DISABLED', 'ERROR'], default: 'SENT' },
    error: String,
    recipients: [
      {
        _id: false,
        role: String,
        userId: { type: Schema.Types.ObjectId, default: null },
        employeeId: { type: Schema.Types.ObjectId, default: null },
        name: String,
        email: String,
        inApp: { type: Boolean, default: false },
        /** TO / CC on the email, or null when not emailed. */
        emailAs: { type: String, enum: ['TO', 'CC', null], default: null },
        /** Why they got nothing (e.g. performed the action themselves, no email address). */
        skipped: { type: String, default: null },
      },
    ],
    escalations: [
      {
        _id: false,
        fromEmployeeId: Schema.Types.ObjectId,
        fromName: String,
        toEmployeeId: { type: Schema.Types.ObjectId, default: null },
        toName: String,
        reason: String,
      },
    ],
    emailLogIds: [{ type: Schema.Types.ObjectId }],
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
notificationDispatchSchema.index({ organizationId: 1, createdAt: -1 });
notificationDispatchSchema.index({ organizationId: 1, event: 1, createdAt: -1 });
notificationDispatchSchema.index({ organizationId: 1, entityId: 1 });
notificationDispatchSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 });
export const NotificationDispatchModel = model('NotificationDispatch', notificationDispatchSchema);

/**
 * Idempotency ledger for scheduled jobs: a run is claimed by inserting its
 * unique key (e.g. `birthdays:<orgId>:<YYYY-MM-DD>`) before doing any work.
 */
const jobRunSchema = new Schema(
  {
    key: { type: String, required: true },
    job: { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, default: null },
    ranAt: { type: Date, default: Date.now },
    result: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false },
);
jobRunSchema.index({ key: 1 }, { unique: true });
jobRunSchema.index({ ranAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const JobRunModel = model('JobRun', jobRunSchema);
