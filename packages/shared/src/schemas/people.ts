import { z } from 'zod';
import {
  BLOOD_GROUPS,
  EMPLOYMENT_STATUS,
  EMPLOYMENT_TYPES,
  ENTITY_STATUS,
  GENDERS,
  LOCATION_TYPES,
} from '../enums';
import {
  dateString,
  nullableDateString,
  nullableObjectId,
  objectId,
  optionalDateString,
  optionalEmail,
  optionalEnum,
  optionalPhone,
  optionalString,
  patchSchema,
  requiredString,
} from './common';

const addressFields = {
  address: optionalString(300),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  postalCode: optionalString(20),
};

export const bankDetailsSchema = z.object({
  bankName: optionalString(120),
  accountHolderName: optionalString(120),
  accountNumber: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{4,34}$/, 'Invalid account number')
      .optional(),
  ),
  ifsc: optionalString(20),
  branch: optionalString(120),
});

export const emergencyContactSchema = z.object({
  contactName: optionalString(120),
  relationship: optionalString(60),
  phone: optionalPhone,
  address: optionalString(300),
});

export const employeeBaseSchema = z.object({
  firstName: requiredString('First name', 60),
  middleName: optionalString(60),
  // Optional: single-name employees are common.
  lastName: z.string().trim().max(60).default(''),
  gender: optionalEnum(GENDERS),
  dateOfBirth: optionalDateString,
  bloodGroup: optionalEnum(BLOOD_GROUPS),
  maritalStatus: optionalEnum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'UNDISCLOSED']),
  /** Celebrated automatically (company announcement + notification on the day). */
  weddingAnniversary: optionalDateString,
  personalEmail: optionalEmail,
  workEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: optionalPhone,
  alternatePhone: optionalPhone,
  ...addressFields,
  joiningDate: dateString,
  confirmationDate: nullableDateString,
  departmentId: nullableObjectId,
  designationId: nullableObjectId,
  managerId: nullableObjectId,
  locationId: nullableObjectId,
  shiftId: nullableObjectId,
  employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  employmentStatus: z.enum(EMPLOYMENT_STATUS).default('ACTIVE'),
  probationPeriodDays: z.coerce.number().int().min(0).max(730).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  bank: bankDetailsSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),
  identity: z.record(z.string().regex(/^[a-zA-Z0-9]{2,31}$/), z.string().trim().max(64)).optional(),
});

export const employeeCreateSchema = employeeBaseSchema.extend({
  // Blank means "auto-generate".
  employeeId: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,20}$/, 'Letters, digits and dashes only')
      .optional(),
  ),
  createUserAccount: z.boolean().default(true),
  roleIds: z.array(objectId).optional(),
  onboardingTemplateId: objectId.optional(),
});
export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;

export const employeeUpdateSchema = patchSchema(employeeBaseSchema).extend({
  // Sensitive details are merged, never cleared wholesale through PATCH.
  bank: employeeBaseSchema.shape.bank,
  identity: employeeBaseSchema.shape.identity,
  changeReason: optionalString(300),
  effectiveDate: optionalDateString,
});
export type EmployeeUpdateInput = z.input<typeof employeeUpdateSchema>;

/** Fields an employee may edit on their own profile. */
export const selfProfileUpdateSchema = employeeBaseSchema
  .pick({
    personalEmail: true,
    phone: true,
    alternatePhone: true,
    address: true,
    city: true,
    state: true,
    country: true,
    postalCode: true,
    bloodGroup: true,
    maritalStatus: true,
    emergencyContact: true,
    // Dates employees add themselves; the company is wished automatically on the day.
    dateOfBirth: true,
    weddingAnniversary: true,
  })
  .partial();

export const employeeListQuery = z.object({
  department: z.string().optional(),
  designation: z.string().optional(),
  location: z.string().optional(),
  manager: z.string().optional(),
  status: z.enum(EMPLOYMENT_STATUS).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
});

export const departmentSchema = z.object({
  name: requiredString('Name', 100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,12}$/, 'Up to 12 letters, digits, dashes'),
  description: optionalString(500),
  headId: nullableObjectId,
  parentId: nullableObjectId,
  status: z.enum(ENTITY_STATUS).default('ACTIVE'),
});
export type DepartmentInput = z.input<typeof departmentSchema>;

export const designationSchema = z.object({
  name: requiredString('Name', 100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,12}$/, 'Up to 12 letters, digits, dashes'),
  level: z.coerce.number().int().min(1).max(20).default(1),
  departmentId: nullableObjectId,
  description: optionalString(500),
  status: z.enum(ENTITY_STATUS).default('ACTIVE'),
});
export type DesignationInput = z.input<typeof designationSchema>;

export const locationSchema = z.object({
  name: requiredString('Name', 100),
  type: z.enum(LOCATION_TYPES).default('OFFICE'),
  ...addressFields,
  timezone: z.string().max(64).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  geofenceRadiusMeters: z.coerce.number().int().min(0).max(50000).optional(),
  status: z.enum(ENTITY_STATUS).default('ACTIVE'),
});
export type LocationInput = z.input<typeof locationSchema>;
