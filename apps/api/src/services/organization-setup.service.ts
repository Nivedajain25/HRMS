import type { ClientSession, Types } from 'mongoose';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLES,
  salaryComponentSchema,
  type LeaveTypeInput,
} from '@stencil/shared';
import {
  LeaveTypeModel,
  OnboardingTemplateModel,
  OrganizationModel,
  PermissionModel,
  RoleModel,
  SalaryComponentModel,
  ShiftModel,
} from '../models';
import { packForCountry } from '../payroll/countries';

export const DEFAULT_LEAVE_TYPES: LeaveTypeInput[] = [
  { name: 'Casual Leave', code: 'CL', color: '#0ea5e9', annualAllowance: 12, halfDayAllowed: true },
  { name: 'Sick Leave', code: 'SL', color: '#f43f5e', annualAllowance: 10, documentRequired: true, documentRequiredAfterDays: 2 },
  { name: 'Earned Leave', code: 'EL', color: '#10b981', annualAllowance: 15, carryForward: true, maximumCarryForward: 30, encashment: true, minNoticeDays: 7 },
  { name: 'Paid Leave', code: 'PL', color: '#6366f1', annualAllowance: 0 },
  { name: 'Unpaid Leave', code: 'LOP', color: '#64748b', paid: false, annualAllowance: 365 },
  { name: 'Maternity Leave', code: 'ML', color: '#ec4899', annualAllowance: 182, halfDayAllowed: false, applicableGenders: ['FEMALE'], documentRequired: true },
  { name: 'Paternity Leave', code: 'PTL', color: '#8b5cf6', annualAllowance: 15, halfDayAllowed: false, applicableGenders: ['MALE'] },
  { name: 'Comp Off', code: 'CO', color: '#f59e0b', annualAllowance: 0 },
  { name: 'Work From Home', code: 'WFH', color: '#14b8a6', annualAllowance: 60, isWorkFromHome: true },
];

const DEFAULT_ONBOARDING_TASKS = [
  { title: 'Submit identity documents', category: 'IDENTITY', assignee: 'EMPLOYEE', dueInDays: 0 },
  { title: 'Provide bank account details', category: 'BANK', assignee: 'EMPLOYEE', dueInDays: 2 },
  { title: 'Sign offer letter', category: 'OFFER_LETTER', assignee: 'EMPLOYEE', dueInDays: -3 },
  { title: 'Sign employment agreement', category: 'AGREEMENT', assignee: 'EMPLOYEE', dueInDays: 0 },
  { title: 'Accept company policies', category: 'POLICY_ACCEPTANCE', assignee: 'EMPLOYEE', dueInDays: 3 },
  { title: 'Upload educational certificates', category: 'DOCUMENTS', assignee: 'EMPLOYEE', dueInDays: 7 },
  { title: 'Allocate laptop and equipment', category: 'EQUIPMENT', assignee: 'IT', dueInDays: 0 },
  { title: 'Create email and system accounts', category: 'ACCOUNTS', assignee: 'IT', dueInDays: 0 },
  { title: 'Team introduction and orientation', category: 'ORIENTATION', assignee: 'MANAGER', dueInDays: 1 },
  { title: 'HR induction session', category: 'ORIENTATION', assignee: 'HR', dueInDays: 2 },
] as const;

/** Keeps the global Permission catalog collection in sync with code. */
export const syncPermissionCatalog = async () => {
  const ops = Object.entries(PERMISSION_GROUPS).flatMap(([group, def]) =>
    Object.entries(def.actions).map(([key, description]) => ({
      updateOne: {
        filter: { key },
        update: { $set: { key, group, groupLabel: def.label, description } },
        upsert: true,
      },
    })),
  );
  await PermissionModel.bulkWrite(ops);
  await PermissionModel.deleteMany({ key: { $nin: ALL_PERMISSIONS } });
};

/**
 * Adds any system role an existing organization is missing (e.g. a role introduced after it signed up).
 * Insert-only: roles that already exist are left exactly as they are.
 */
export const ensureSystemRoles = async () => {
  const orgIds = await OrganizationModel.distinct('_id');
  for (const organizationId of orgIds) {
    const have = new Set((await RoleModel.find({ organizationId, key: { $in: [...SYSTEM_ROLE_KEYS] } }).select('key').lean()).map((r) => r.key));
    const missing = SYSTEM_ROLE_KEYS.filter((key) => !have.has(key));
    if (!missing.length) continue;
    await RoleModel.insertMany(
      missing.map((key) => ({
        organizationId,
        key,
        name: SYSTEM_ROLES[key].name,
        description: SYSTEM_ROLES[key].description,
        permissions: SYSTEM_ROLES[key].permissions,
        isSystem: true,
      })),
    );
  }
};

/** Creates system roles for an organization and returns them keyed by role key. */
export const provisionRoles = async (organizationId: Types.ObjectId, session?: ClientSession) => {
  const roles = await RoleModel.insertMany(
    SYSTEM_ROLE_KEYS.map((key) => ({
      organizationId,
      key,
      name: SYSTEM_ROLES[key].name,
      description: SYSTEM_ROLES[key].description,
      permissions: SYSTEM_ROLES[key].permissions,
      isSystem: true,
    })),
    { session },
  );
  return Object.fromEntries(roles.map((r) => [r.key, r])) as Record<(typeof SYSTEM_ROLE_KEYS)[number], (typeof roles)[number]>;
};

/** Seeds sensible, editable defaults for a brand new organization. */
export const provisionDefaults = async (organizationId: Types.ObjectId, country: string | undefined, session?: ClientSession) => {
  const pack = packForCountry(country);
  await LeaveTypeModel.insertMany(
    DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, organizationId })),
    { session },
  );
  await SalaryComponentModel.insertMany(
    [
      { name: 'Basic Salary', code: 'BASIC', type: 'EARNING', calculationType: 'FIXED', defaultValue: 0, order: 1 },
      ...pack.components,
    ].map((c) => ({ ...salaryComponentSchema.parse(c), organizationId })),
    { session },
  );
  await ShiftModel.create(
    [
      {
        organizationId,
        name: 'General Shift',
        code: 'GEN',
        startTime: '09:00',
        endTime: '18:00',
        gracePeriodMinutes: 15,
        breakDurationMinutes: 60,
        workingHours: 8,
        halfDayHours: 4,
        isDefault: true,
      },
    ],
    { session },
  );
  await OnboardingTemplateModel.create(
    [{ organizationId, name: 'Standard Onboarding', description: 'Default onboarding checklist', isDefault: true, tasks: DEFAULT_ONBOARDING_TASKS }],
    { session },
  );
  return { countryRules: pack.code };
};
