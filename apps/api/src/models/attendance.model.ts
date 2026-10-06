import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { APPROVAL_STATUS, ATTENDANCE_STATUS, HOLIDAY_TYPES, WORK_MODES } from '@stencil/shared';
import { approvalFields } from './approval.schema';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const shiftSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    gracePeriodMinutes: { type: Number, default: 15 },
    breakDurationMinutes: { type: Number, default: 60 },
    workingHours: { type: Number, default: 8 },
    halfDayHours: { type: Number, default: 4 },
    nightShift: { type: Boolean, default: false },
    flexible: { type: Boolean, default: false },
    color: { type: String, default: '#6366f1' },
    isDefault: { type: Boolean, default: false },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
shiftSchema.index({ organizationId: 1, code: 1 }, { unique: true });
export type Shift = InferSchemaType<typeof shiftSchema>;
export const ShiftModel = model('Shift', shiftSchema);

/** Dated shift assignment; the history of assignments is the shift history. */
const shiftAssignmentSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    shiftId: ref('Shift', true),
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    assignedBy: ref('User'),
  },
  { timestamps: true, versionKey: false },
);
shiftAssignmentSchema.index({ organizationId: 1, employeeId: 1, effectiveFrom: -1 });
shiftAssignmentSchema.index({ organizationId: 1, shiftId: 1, effectiveTo: 1 });
export const ShiftAssignmentModel = model('ShiftAssignment', shiftAssignmentSchema);

const breakSchema = new Schema({ start: { type: Date, required: true }, end: { type: Date, default: null } }, { _id: false });

/**
 * GPS reported by the device at clock-in/out (accuracy in meters), plus where that was relative to the
 * employee's office at the time: office snapshot, straight-line distance and whether it is inside the
 * office's geofence (null when the office has no coordinates or no radius).
 */
const geoCaptureSchema = new Schema(
  {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    /** Street address of the point (from the device, or looked up by the server). */
    address: String,
    officeId: { type: Schema.Types.ObjectId, ref: 'Location' },
    officeName: String,
    distanceMeters: Number,
    withinOffice: { type: Boolean, default: undefined },
  },
  { _id: false },
);

const attendanceSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    /** Calendar day in organization timezone, stored at 00:00 UTC. */
    date: { type: Date, required: true },
    shiftId: ref('Shift'),
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    breaks: { type: [breakSchema], default: [] },
    workMode: { type: String, enum: WORK_MODES, default: 'OFFICE' },
    status: { type: String, enum: ATTENDANCE_STATUS, default: 'PRESENT' },
    workingMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    earlyDepartureMinutes: { type: Number, default: 0 },
    isLate: { type: Boolean, default: false },
    isEarlyDeparture: { type: Boolean, default: false },
    /** Where the employee clocked in (GPS + office proximity). */
    checkInLocation: { type: geoCaptureSchema, default: undefined },
    /** Where the employee clocked out (GPS + office proximity). */
    checkOutLocation: { type: geoCaptureSchema, default: undefined },
    /** Selfies (Document, context ATTENDANCE) captured at clock-in / clock-out. */
    checkInPhotoId: ref('Document'),
    checkOutPhotoId: ref('Document'),
    note: String,
    source: { type: String, enum: ['WEB', 'MOBILE', 'REGULARIZATION', 'ADMIN', 'SYSTEM', 'BIOMETRIC'], default: 'WEB' },
    regularized: { type: Boolean, default: false },
  },
  baseSchemaOptions,
);
attendanceSchema.index({ organizationId: 1, employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ organizationId: 1, date: 1, status: 1 });
/** Supports the auto clock-out sweep (open records). */
attendanceSchema.index({ organizationId: 1, checkOut: 1, date: 1 });
/** Selfie reuse checks. */
attendanceSchema.index({ organizationId: 1, checkInPhotoId: 1 }, { partialFilterExpression: { checkInPhotoId: { $type: 'objectId' } } });
attendanceSchema.index({ organizationId: 1, checkOutPhotoId: 1 }, { partialFilterExpression: { checkOutPhotoId: { $type: 'objectId' } } });
export type Attendance = InferSchemaType<typeof attendanceSchema>;
export type AttendanceDoc = HydratedDocument<Attendance>;
export const AttendanceModel = model('Attendance', attendanceSchema);

const attendanceCorrectionSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    date: { type: Date, required: true },
    requestedCheckIn: { type: String, required: true },
    requestedCheckOut: { type: String, required: true },
    originalCheckIn: { type: Date, default: null },
    originalCheckOut: { type: Date, default: null },
    reason: { type: String, required: true },
    attachmentId: ref('Document'),
    status: { type: String, enum: APPROVAL_STATUS, default: 'SUBMITTED' },
    ...approvalFields,
    requestedBy: ref('User'),
    rejectionReason: String,
    submittedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
attendanceCorrectionSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
attendanceCorrectionSchema.index({ organizationId: 1, employeeId: 1, date: 1 });
export type AttendanceCorrection = InferSchemaType<typeof attendanceCorrectionSchema>;
export const AttendanceCorrectionModel = model('AttendanceCorrection', attendanceCorrectionSchema);

const holidaySchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    type: { type: String, enum: HOLIDAY_TYPES, default: 'PUBLIC' },
    description: String,
    /** Empty = applies to all locations. */
    locationIds: [{ type: Schema.Types.ObjectId, ref: 'Location' }],
    /** Recurring holidays repeat on the same month/day every year. */
    recurring: { type: Boolean, default: false },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
holidaySchema.index({ organizationId: 1, date: 1 });
export type Holiday = InferSchemaType<typeof holidaySchema>;
export const HolidayModel = model('Holiday', holidaySchema);
