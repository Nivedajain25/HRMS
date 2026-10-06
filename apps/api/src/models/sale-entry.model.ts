import { Schema, model, type InferSchemaType } from 'mongoose';
import { MEETING_OUTCOMES, MEETING_TYPES } from '@stencil/shared';
import { ref, tenantField } from './plugins';

/** One sale recorded by an employee for themselves (their individual sales and report). */
const saleEntrySchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    /** Calendar day of the sale, `YYYY-MM-DD`. */
    date: { type: String, required: true },
    customer: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    note: { type: String, trim: true },
    createdBy: ref('User'),
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
saleEntrySchema.index({ organizationId: 1, employeeId: 1, date: -1 });
saleEntrySchema.index({ organizationId: 1, date: -1 });

export type SaleEntry = InferSchemaType<typeof saleEntrySchema>;
export const SaleEntryModel = model('SaleEntry', saleEntrySchema);

/** An employee's sales target for one month, set by HR / admin. "Achieved" is their logged sales that month. */
const salesTargetSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    /** `YYYY-MM`. */
    month: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    setBy: ref('User'),
  },
  { timestamps: true, versionKey: false },
);
salesTargetSchema.index({ organizationId: 1, employeeId: 1, month: 1 }, { unique: true });
salesTargetSchema.index({ organizationId: 1, month: 1 });

export type SalesTarget = InferSchemaType<typeof salesTargetSchema>;
export const SalesTargetModel = model('SalesTarget', salesTargetSchema);

/** One meeting with an architect, logged by the employee who met them. */
const architectMeetingSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    /** `YYYY-MM-DD`. */
    date: { type: String, required: true },
    architectName: { type: String, required: true, trim: true },
    firm: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    meetingType: { type: String, enum: [...MEETING_TYPES, null], default: null },
    projectName: { type: String, trim: true },
    /** Site / city of the project or meeting. */
    location: { type: String, trim: true },
    productsDiscussed: { type: String, trim: true },
    outcome: { type: String, enum: [...MEETING_OUTCOMES, null], default: null },
    /** `YYYY-MM-DD`. */
    followUpDate: { type: String, default: null },
    /** Detailed description of the meeting. */
    notes: { type: String, trim: true },
    createdBy: ref('User'),
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
architectMeetingSchema.index({ organizationId: 1, employeeId: 1, date: -1 });
architectMeetingSchema.index({ organizationId: 1, date: -1 });

export type ArchitectMeeting = InferSchemaType<typeof architectMeetingSchema>;
export const ArchitectMeetingModel = model('ArchitectMeeting', architectMeetingSchema);
