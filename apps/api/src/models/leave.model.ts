import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { GENDERS, HALF_DAY_SESSIONS, LEAVE_STATUS } from '@stencil/shared';
import { approvalFields } from './approval.schema';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const leaveTypeSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true },
    description: String,
    color: { type: String, default: '#0ea5e9' },
    paid: { type: Boolean, default: true },
    annualAllowance: { type: Number, default: 12, min: 0 },
    accrual: { type: String, enum: ['ANNUAL', 'MONTHLY'], default: 'ANNUAL' },
    carryForward: { type: Boolean, default: false },
    maximumCarryForward: { type: Number, default: 0 },
    encashment: { type: Boolean, default: false },
    halfDayAllowed: { type: Boolean, default: true },
    documentRequired: { type: Boolean, default: false },
    documentRequiredAfterDays: { type: Number, default: 0 },
    maxConsecutiveDays: { type: Number, default: 0 },
    minNoticeDays: { type: Number, default: 0 },
    applicableGenders: [{ type: String, enum: GENDERS }],
    isWorkFromHome: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
leaveTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true });
export type LeaveType = InferSchemaType<typeof leaveTypeSchema>;
export const LeaveTypeModel = model('LeaveType', leaveTypeSchema);

const balanceTxnSchema = new Schema(
  {
    type: { type: String, enum: ['ALLOCATION', 'CARRY_FORWARD', 'ADJUSTMENT', 'USED', 'RESTORED', 'ENCASHED'] },
    days: Number,
    reason: String,
    leaveRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * Per-employee, per-type, per-year balance.
 * remaining = opening + allocated + carryForward + adjusted - used - pending
 */
const leaveBalanceSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    leaveTypeId: ref('LeaveType', true),
    year: { type: Number, required: true },
    opening: { type: Number, default: 0 },
    allocated: { type: Number, default: 0 },
    carryForward: { type: Number, default: 0 },
    adjusted: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    encashed: { type: Number, default: 0 },
    transactions: { type: [balanceTxnSchema], default: [] },
  },
  { ...baseSchemaOptions, optimisticConcurrency: true },
);
leaveBalanceSchema.index({ organizationId: 1, employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });
export const remainingBalance = (b: {
  opening: number;
  allocated: number;
  carryForward: number;
  adjusted: number;
  used: number;
  pending: number;
  encashed: number;
}) => Math.round((b.opening + b.allocated + b.carryForward + b.adjusted - b.used - b.pending - b.encashed) * 100) / 100;

leaveBalanceSchema.virtual('remaining').get(function (this: Parameters<typeof remainingBalance>[0]) {
  return remainingBalance(this);
});
leaveBalanceSchema.set('toJSON', { ...baseSchemaOptions.toJSON, virtuals: true });
export type LeaveBalance = InferSchemaType<typeof leaveBalanceSchema>;
export type LeaveBalanceDoc = HydratedDocument<LeaveBalance>;
export const LeaveBalanceModel = model('LeaveBalance', leaveBalanceSchema);

const leaveRequestSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    leaveTypeId: ref('LeaveType', true),
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    halfDay: { type: Boolean, default: false },
    halfDaySession: { type: String, enum: [...HALF_DAY_SESSIONS, null], default: null },
    /** Working days charged (weekends/holidays excluded, 0.5 for half day). */
    days: { type: Number, required: true },
    reason: { type: String, required: true },
    attachmentId: ref('Document'),
    status: { type: String, enum: LEAVE_STATUS, default: 'SUBMITTED' },
    ...approvalFields,
    rejectionReason: String,
    cancellationReason: String,
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: ref('User'),
    requestedBy: ref('User'),
  },
  baseSchemaOptions,
);
leaveRequestSchema.index({ organizationId: 1, employeeId: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ organizationId: 1, leaveTypeId: 1, status: 1 });
leaveRequestSchema.index({ organizationId: 1, status: 1, startDate: -1 });
export type LeaveRequest = InferSchemaType<typeof leaveRequestSchema>;
export type LeaveRequestDoc = HydratedDocument<LeaveRequest>;
export const LeaveRequestModel = model('LeaveRequest', leaveRequestSchema);
