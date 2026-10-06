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
  },
  { timestamps: true, versionKey: false },
);
notificationSchema.index({ organizationId: 1, userId: 1, readAt: 1, createdAt: -1 });
// Keep notifications for one year.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });
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
    to: { type: String, required: true },
    template: { type: String, required: true },
    subject: String,
    status: { type: String, enum: ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'], default: 'QUEUED' },
    error: String,
    messageId: String,
    sentAt: Date,
  },
  { timestamps: true, versionKey: false },
);
emailLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
export const EmailLogModel = model('EmailLog', emailLogSchema);

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
