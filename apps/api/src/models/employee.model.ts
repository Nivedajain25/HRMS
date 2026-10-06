import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  BLOOD_GROUPS,
  EMPLOYEE_HISTORY_FIELDS,
  EMPLOYMENT_STATUS,
  EMPLOYMENT_TYPES,
  GENDERS,
} from '@stencil/shared';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const employeeSchema = new Schema(
  {
    ...tenantField,
    employeeId: { type: String, required: true, trim: true },
    userId: ref('User'),
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true },
    // Optional: single-name employees are common.
    lastName: { type: String, trim: true, default: '' },
    profilePhoto: { type: String, default: null },
    gender: { type: String, enum: GENDERS },
    dateOfBirth: Date,
    /** Optional; celebrated automatically each year (announcement + notification). */
    weddingAnniversary: { type: Date, default: null },
    bloodGroup: { type: String, enum: BLOOD_GROUPS },
    maritalStatus: String,

    personalEmail: { type: String, lowercase: true, trim: true },
    workEmail: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    alternatePhone: String,

    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String,

    joiningDate: { type: Date, required: true },
    confirmationDate: { type: Date, default: null },
    exitDate: { type: Date, default: null },
    departmentId: ref('Department'),
    designationId: ref('Designation'),
    managerId: ref('Employee'),
    locationId: ref('Location'),
    shiftId: ref('Shift'),
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FULL_TIME' },
    employmentStatus: { type: String, enum: EMPLOYMENT_STATUS, default: 'ACTIVE' },
    /** Not tracked for attendance (e.g. the owner / head): never counted present or absent, never auto-marked. */
    attendanceExempt: { type: Boolean, default: false },
    probationPeriodDays: { type: Number, default: 90 },
    noticePeriodDays: { type: Number, default: 30 },

    // Sensitive: excluded from queries by default, account number encrypted at rest.
    bank: {
      type: new Schema(
        {
          bankName: String,
          accountHolderName: String,
          accountNumberEncrypted: String,
          accountNumberMasked: String,
          ifsc: String,
          branch: String,
        },
        { _id: false },
      ),
      select: false,
      default: undefined,
    },
    // Configurable identity numbers (PAN, passport, tax ID...), each encrypted.
    identity: { type: Map, of: String, select: false, default: undefined },

    emergencyContact: {
      contactName: String,
      relationship: String,
      phone: String,
      address: String,
    },
    ...softDeleteField,
  },
  baseSchemaOptions,
);

employeeSchema.index({ organizationId: 1, employeeId: 1 }, { unique: true });
employeeSchema.index({ organizationId: 1, workEmail: 1 }, { unique: true });
employeeSchema.index({ organizationId: 1, deletedAt: 1, employmentStatus: 1 });
employeeSchema.index({ organizationId: 1, departmentId: 1 });
employeeSchema.index({ organizationId: 1, managerId: 1 });
employeeSchema.index({ organizationId: 1, firstName: 1, lastName: 1 });

export type Employee = InferSchemaType<typeof employeeSchema>;
export type EmployeeDoc = HydratedDocument<Employee>;
export const EmployeeModel = model('Employee', employeeSchema);

/** Retains every change to important employment attributes. */
const employeeHistorySchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    field: { type: String, enum: EMPLOYEE_HISTORY_FIELDS, required: true },
    oldValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    oldLabel: String,
    newLabel: String,
    effectiveDate: { type: Date, required: true },
    reason: String,
    changedBy: ref('User'),
  },
  { timestamps: true, versionKey: false },
);
employeeHistorySchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

export const EmployeeHistoryModel = model('EmployeeHistory', employeeHistorySchema);
