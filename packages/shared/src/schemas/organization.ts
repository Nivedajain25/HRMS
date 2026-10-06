import { z } from 'zod';
import { APPROVER_TYPES, USER_STATUS, WEEKDAYS } from '../enums';
import { ALL_PERMISSIONS } from '../permissions';
import {
  email,
  objectId,
  optionalEmail,
  optionalPhone,
  optionalString,
  requiredString,
  timeString,
} from './common';

export const approvalChainSchema = z
  .array(z.enum(APPROVER_TYPES))
  .min(1, 'At least one approval step is required')
  .max(4)
  .refine((steps) => new Set(steps).size === steps.length, 'Approval steps must be unique');

export const identityFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{1,30}$/),
  label: requiredString('Label', 60),
  enabled: z.boolean(),
  required: z.boolean().default(false),
});

export const organizationUpdateSchema = z.object({
  name: requiredString('Name', 120).optional(),
  legalName: optionalString(200),
  email: optionalEmail,
  phone: optionalPhone,
  website: optionalString(200),
  address: optionalString(300),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  postalCode: optionalString(20),
  timezone: z.string().min(1).max(64).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd MMM yyyy']).optional(),
  fiscalYearStart: z.coerce.number().int().min(1).max(12).optional(),
  workingDays: z.array(z.enum(WEEKDAYS)).min(1).optional(),
  /** Logo served by the authenticated files endpoint: `/api/v1/files/<id>`. */
  logo: z
    .string()
    .regex(/^\/api\/v1\/files\/[a-f\d]{24}$/i, 'Invalid logo reference')
    .nullable()
    .optional(),
  employeeIdPrefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{1,8}$/, 'Use up to 8 uppercase letters, digits or dashes')
    .optional(),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

export const organizationSettingsSchema = z.object({
  attendance: z
    .object({
      allowRemoteClockIn: z.boolean(),
      halfDayThresholdHours: z.coerce.number().min(0).max(24),
      overtimeAfterHours: z.coerce.number().min(0).max(24),
      autoMarkAbsent: z.boolean(),
      defaultShiftStart: timeString,
      defaultShiftEnd: timeString,
      requireSelfie: z.boolean(),
      requireLocation: z.boolean(),
    })
    .partial()
    .optional(),
  approvals: z
    .object({
      leave: approvalChainSchema,
      regularization: approvalChainSchema,
      expense: approvalChainSchema,
    })
    .partial()
    .optional(),
  leave: z
    .object({
      allowNegativeBalance: z.boolean(),
      allowBackdatedDays: z.coerce.number().int().min(0).max(365),
    })
    .partial()
    .optional(),
  payroll: z
    .object({
      payDay: z.coerce.number().int().min(1).max(31),
      workingDaysBasis: z.enum(['CALENDAR', 'WORKING']),
      overtimeMultiplier: z.coerce.number().min(1).max(5),
      countryRules: z.string().max(10),
    })
    .partial()
    .optional(),
  identityFields: z.array(identityFieldSchema).max(20).optional(),
  security: z
    .object({
      sessionTimeoutMinutes: z.coerce.number().int().min(5).max(1440),
      maxLoginAttempts: z.coerce.number().int().min(3).max(20),
    })
    .partial()
    .optional(),
  notifications: z
    .object({
      documentExpiryDays: z.coerce.number().int().min(1).max(180),
      birthdayReminders: z.boolean(),
      anniversaryReminders: z.boolean(),
    })
    .partial()
    .optional(),
});
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>;

export const roleSchema = z.object({
  name: requiredString('Role name', 60),
  description: optionalString(300),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(200),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const userCreateSchema = z.object({
  email,
  firstName: requiredString('First name', 60),
  lastName: requiredString('Last name', 60),
  roleIds: z.array(objectId).min(1, 'Select at least one role'),
  employeeId: objectId.optional(),
  sendInvite: z.boolean().default(true),
});
export const userUpdateSchema = z.object({
  firstName: requiredString('First name', 60).optional(),
  lastName: requiredString('Last name', 60).optional(),
  roleIds: z.array(objectId).min(1).optional(),
  status: z.enum(USER_STATUS).optional(),
});
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.enum(['en']).optional(),
});
