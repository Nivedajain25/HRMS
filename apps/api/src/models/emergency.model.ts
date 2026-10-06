import { Schema, model, type InferSchemaType } from 'mongoose';
import { EMERGENCY_CATEGORIES, EMERGENCY_STATUS } from '@stencil/shared';
import { ref, tenantField } from './plugins';

/**
 * A personal emergency raised by an employee (family, health, home, child...), usually meaning they must leave
 * work right away. HR (`emergency:manage`) and the
 * employee's manager are alerted immediately; HR acknowledges it, then resolves it.
 */
const emergencySchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    raisedBy: ref('User', true),
    category: { type: String, enum: EMERGENCY_CATEGORIES, required: true },
    message: String,
    /** They have to leave work right away (e.g. go home). */
    needToLeave: { type: Boolean, default: true },
    contactPhone: String,
    location: {
      type: new Schema({ latitude: Number, longitude: Number, accuracy: Number }, { _id: false }),
      default: null,
    },
    status: { type: String, enum: EMERGENCY_STATUS, default: 'OPEN' },
    acknowledgedBy: ref('User'),
    acknowledgedAt: { type: Date, default: null },
    resolvedBy: ref('User'),
    resolvedAt: { type: Date, default: null },
    /** HR's answer to "can I leave?": approved or declined (null until decided). Deciding also resolves the alert. */
    decision: { type: String, enum: ['APPROVED', 'DECLINED'], default: null },
    decidedBy: ref('User'),
    decidedAt: { type: Date, default: null },
    /** HR's notes (what was done), newest last. */
    notes: {
      type: [{ _id: false, by: ref('User'), byName: String, text: String, at: { type: Date, default: Date.now } }],
      default: [],
    },
  },
  { timestamps: true, versionKey: false },
);
emergencySchema.index({ organizationId: 1, status: 1, createdAt: -1 });
emergencySchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

export type Emergency = InferSchemaType<typeof emergencySchema>;
export const EmergencyModel = model('Emergency', emergencySchema);
