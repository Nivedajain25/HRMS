import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { APPROVER_TYPES, ORGANIZATION_STATUS, WEEKDAYS } from '@stencil/shared';
import { baseSchemaOptions } from './plugins';

const approvalChain = (defaults: string[]) => ({
  type: [{ type: String, enum: APPROVER_TYPES }],
  default: defaults,
});

const settingsSchema = new Schema(
  {
    attendance: {
      allowRemoteClockIn: { type: Boolean, default: true },
      halfDayThresholdHours: { type: Number, default: 4 },
      overtimeAfterHours: { type: Number, default: 9 },
      autoMarkAbsent: { type: Boolean, default: true },
      defaultShiftStart: { type: String, default: '09:00' },
      defaultShiftEnd: { type: String, default: '18:00' },
      /** Self-service clock in/out must include a fresh selfie. */
      requireSelfie: { type: Boolean, default: false },
      /** Self-service clock in/out must include GPS coordinates. */
      requireLocation: { type: Boolean, default: false },
      /** Employees can start / end breaks while clocked in. Off until the Super Admin turns it on. */
      allowBreaks: { type: Boolean, default: false },
    },
    approvals: {
      leave: approvalChain(['MANAGER']),
      regularization: approvalChain(['MANAGER', 'HR']),
      expense: approvalChain(['MANAGER', 'FINANCE']),
    },
    leave: {
      allowNegativeBalance: { type: Boolean, default: false },
      allowBackdatedDays: { type: Number, default: 30 },
    },
    payroll: {
      payDay: { type: Number, default: 30 },
      workingDaysBasis: { type: String, enum: ['CALENDAR', 'WORKING'], default: 'CALENDAR' },
      overtimeMultiplier: { type: Number, default: 1.5 },
      countryRules: { type: String, default: 'GENERIC' },
    },
    identityFields: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          label: { type: String, required: true },
          enabled: { type: Boolean, default: true },
          required: { type: Boolean, default: false },
        },
      ],
      default: [
        { key: 'taxId', label: 'Tax ID', enabled: true, required: false },
        { key: 'pan', label: 'PAN', enabled: false, required: false },
        { key: 'aadhaar', label: 'Aadhaar', enabled: false, required: false },
        { key: 'passport', label: 'Passport', enabled: true, required: false },
      ],
    },
    security: {
      sessionTimeoutMinutes: { type: Number, default: 480 },
      maxLoginAttempts: { type: Number, default: 5 },
    },
    notifications: {
      documentExpiryDays: { type: Number, default: 30 },
      birthdayReminders: { type: Boolean, default: true },
      anniversaryReminders: { type: Boolean, default: true },
    },
  },
  { _id: false },
);

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    legalName: { type: String, trim: true },
    logo: { type: String, default: null },
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    website: String,
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, default: 'USD', uppercase: true, minlength: 3, maxlength: 3 },
    dateFormat: { type: String, default: 'dd MMM yyyy' },
    fiscalYearStart: { type: Number, default: 1, min: 1, max: 12 },
    workingDays: {
      type: [{ type: String, enum: WEEKDAYS }],
      default: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    },
    employeeIdPrefix: { type: String, default: 'EMP' },
    employeeSequence: { type: Number, default: 0 },
    assetSequence: { type: Number, default: 0 },
    status: { type: String, enum: ORGANIZATION_STATUS, default: 'ACTIVE' },
    settings: { type: settingsSchema, default: () => ({}) },
  },
  baseSchemaOptions,
);

organizationSchema.virtual('weekends').get(function (this: { workingDays: string[] }) {
  return WEEKDAYS.filter((d) => !this.workingDays.includes(d));
});
organizationSchema.set('toJSON', { ...baseSchemaOptions.toJSON, virtuals: true });

export type Organization = InferSchemaType<typeof organizationSchema>;
export type OrganizationDoc = HydratedDocument<Organization>;
export const OrganizationModel = model('Organization', organizationSchema);
