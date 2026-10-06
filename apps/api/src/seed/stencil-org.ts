/**
 * Stencil (the company) — organization structure from the org chart.
 *
 * `pnpm seed:stencil` (re)creates the organization with slug `stencil`:
 * departments per team, designations with levels, all 18 employees and their
 * reporting lines. Only the `stencil` organization is wiped and recreated.
 *
 * Placeholders to replace in the app (People → Employees → Edit):
 *  - work emails (`<name>@stencil.local`) — no invitations are sent to them
 *  - joining date (set to 2020-01-01 so leave and payroll are not prorated)
 * Only Nitin (Head) gets a login; invite others from Settings → Users once
 * their real emails are entered.
 */
import mongoose, { type Types } from 'mongoose';
import {
  ActionTokenModel,
  DepartmentModel,
  DesignationModel,
  EmployeeModel,
  LocationModel,
  OrganizationModel,
  ShiftAssignmentModel,
  ShiftModel,
  UserModel,
} from '../models';
import { hashPassword } from '../services/auth.service';
import { ensureLeaveBalances } from '../services/leave-balance.service';
import { provisionDefaults, provisionRoles, syncPermissionCatalog } from '../services/organization-setup.service';
import { dateOnly, todayKey } from '../utils/dates';

export const STENCIL_SLUG = 'stencil';
const TZ = 'Asia/Kolkata';
const EMAIL_DOMAIN = 'stencil.local';
const JOINING_DATE = '2020-01-01';

/** Head's login (development). Change the password after first sign-in. */
export const STENCIL_ADMIN = { email: `nitin@${EMAIL_DOMAIN}`, password: 'Stencil@12345' };

const DEPARTMENTS = [
  { code: 'MGMT', name: 'Management' },
  { code: 'ACC', name: 'Accounts' },
  { code: 'ADMIN', name: 'Administration' },
  { code: 'ENG', name: 'Engineering' },
  { code: 'DESIGN', name: 'Design' },
  { code: 'INST', name: 'Installation' },
  { code: 'WH', name: 'Warehouse' },
] as const;
type DeptCode = (typeof DEPARTMENTS)[number]['code'];

/** Level: higher = more senior. */
const DESIGNATIONS = [
  { code: 'HEAD', name: 'Head', level: 10, dept: 'MGMT' },
  { code: 'PARTNER', name: 'Partner', level: 9, dept: 'ENG' },
  { code: 'ACCMGR', name: 'Accounts Manager', level: 7, dept: 'ACC' },
  { code: 'WHMGR', name: 'Warehouse Manager', level: 7, dept: 'WH' },
  { code: 'ADMIN', name: 'Admin', level: 6, dept: 'ADMIN' },
  { code: 'DSGNCON', name: 'Design Consultant', level: 5, dept: 'DESIGN' },
  { code: 'ENGR', name: 'Engineer', level: 5, dept: 'ENG' },
  { code: 'JRACC', name: 'Junior Accountant', level: 4, dept: 'ACC' },
  { code: 'SOCIAL', name: 'Social Media', level: 4, dept: 'ACC' },
  { code: 'INSTALL', name: 'Installer', level: 3, dept: 'INST' },
  { code: 'DISPATCH', name: 'Dispatch', level: 3, dept: 'ADMIN' },
  { code: 'RUNNER', name: 'Runner', level: 2, dept: 'ACC' },
  { code: 'HOUSEKEEP', name: 'House Keeping', level: 2, dept: 'ADMIN' },
  { code: 'HELPER', name: 'Helping Staff', level: 1, dept: 'ACC' },
  { code: 'LABOUR', name: 'Labour', level: 1, dept: 'WH' },
] as const;
type DesigCode = (typeof DESIGNATIONS)[number]['code'];

interface Person {
  key: string;
  name: string;
  designation: DesigCode;
  department: DeptCode;
  manager: string | null;
}

/** Exactly as in the org chart. */
export const STENCIL_PEOPLE: Person[] = [
  { key: 'nitin', name: 'Nitin', designation: 'HEAD', department: 'MGMT', manager: null },
  // Accounts — Deepak's team
  { key: 'deepak', name: 'Deepak', designation: 'ACCMGR', department: 'ACC', manager: 'nitin' },
  { key: 'suchithra', name: 'Suchithra', designation: 'JRACC', department: 'ACC', manager: 'deepak' },
  { key: 'niveda', name: 'Niveda', designation: 'SOCIAL', department: 'ACC', manager: 'deepak' },
  { key: 'nandakumar', name: 'Nandakumar', designation: 'RUNNER', department: 'ACC', manager: 'deepak' },
  { key: 'kissan', name: 'Kissan', designation: 'HELPER', department: 'ACC', manager: 'deepak' },
  { key: 'ronak', name: 'Ronak', designation: 'HELPER', department: 'ACC', manager: 'deepak' },
  // Administration — Ambritha's team
  { key: 'ambritha', name: 'Ambritha', designation: 'ADMIN', department: 'ADMIN', manager: 'nitin' },
  { key: 'chaitra', name: 'Chaitra', designation: 'DISPATCH', department: 'ADMIN', manager: 'ambritha' },
  { key: 'mangala', name: 'Mangala', designation: 'HOUSEKEEP', department: 'ADMIN', manager: 'ambritha' },
  // Engineering — Rahul (Partner)
  { key: 'rahul', name: 'Rahul', designation: 'PARTNER', department: 'ENG', manager: 'nitin' },
  { key: 'srinivas', name: 'Srinivas', designation: 'ENGR', department: 'ENG', manager: 'rahul' },
  // Design
  { key: 'mannath', name: 'Mannath', designation: 'DSGNCON', department: 'DESIGN', manager: 'nitin' },
  { key: 'bhagyavathi', name: 'Bhagyavathi', designation: 'DSGNCON', department: 'DESIGN', manager: 'nitin' },
  // Installation
  { key: 'manju', name: 'Manju', designation: 'INSTALL', department: 'INST', manager: 'nitin' },
  // Warehouse — Chiranjeevi's team
  { key: 'chiranjeevi', name: 'Chiranjeevi', designation: 'WHMGR', department: 'WH', manager: 'nitin' },
  { key: 'vijay', name: 'Vijay', designation: 'LABOUR', department: 'WH', manager: 'chiranjeevi' },
  { key: 'sunny', name: 'Sunny', designation: 'LABOUR', department: 'WH', manager: 'chiranjeevi' },
];

/** Department heads (team leads from the chart). */
const DEPARTMENT_HEADS: Partial<Record<DeptCode, string>> = {
  MGMT: 'nitin',
  ACC: 'deepak',
  ADMIN: 'ambritha',
  ENG: 'rahul',
  WH: 'chiranjeevi',
};

export const wipeStencil = async () => {
  const org = await OrganizationModel.findOne({ slug: STENCIL_SLUG }).select('_id').lean();
  if (!org) return false;
  const users = await UserModel.find({ organizationId: org._id }).select('_id').lean();
  await ActionTokenModel.deleteMany({ userId: { $in: users.map((u) => u._id) } });
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    if (!model.schema.path('organizationId')) continue;
    await model.collection.deleteMany({ organizationId: org._id });
  }
  await OrganizationModel.collection.deleteOne({ _id: org._id });
  return true;
};

/**
 * Creates the Stencil organization. An existing one (real data!) is only wiped and
 * recreated when `replace` is true (`pnpm seed:stencil --force`).
 */
export const seedStencil = async ({ replace = false } = {}) => {
  await syncPermissionCatalog();
  const existing = await OrganizationModel.exists({ slug: STENCIL_SLUG });
  if (existing && !replace) {
    throw new Error('The Stencil organization already exists; refusing to overwrite it. Re-run with --force to DELETE all its data and recreate it.');
  }
  await wipeStencil();
  const clash = await UserModel.findOne({ email: STENCIL_ADMIN.email }).select('_id').lean();
  if (clash) throw new Error(`${STENCIL_ADMIN.email} already exists in another organization; remove it first.`);

  const org = await OrganizationModel.create({
    name: 'Stencil',
    slug: STENCIL_SLUG,
    legalName: 'Stencil',
    country: 'India',
    timezone: TZ,
    currency: 'INR',
    employeeIdPrefix: 'STN',
  });
  const orgId = org._id;
  const roles = await provisionRoles(orgId);
  const { countryRules } = await provisionDefaults(orgId, 'India');
  org.settings!.payroll!.countryRules = countryRules;
  // Selfie + GPS verification at clock in/out.
  org.settings!.attendance!.requireSelfie = true;
  org.settings!.attendance!.requireLocation = true;
  await org.save();

  const [office] = await LocationModel.create([{ organizationId: orgId, name: 'Head Office', type: 'OFFICE', country: 'India', timezone: TZ }]);
  const shift = await ShiftModel.findOne({ organizationId: orgId, isDefault: true }).lean();

  const deptIds = new Map<DeptCode, Types.ObjectId>();
  for (const d of DEPARTMENTS) {
    const [doc] = await DepartmentModel.create([{ organizationId: orgId, name: d.name, code: d.code }]);
    deptIds.set(d.code, doc!._id);
  }
  const desigIds = new Map<DesigCode, Types.ObjectId>();
  for (const d of DESIGNATIONS) {
    const [doc] = await DesignationModel.create([{ organizationId: orgId, name: d.name, code: d.code, level: d.level, departmentId: deptIds.get(d.dept) }]);
    desigIds.set(d.code, doc!._id);
  }

  // Create in chart order so managers exist before their reports.
  const empIds = new Map<string, Types.ObjectId>();
  let seq = 0;
  for (const p of STENCIL_PEOPLE) {
    seq += 1;
    const [emp] = await EmployeeModel.create([
      {
        organizationId: orgId,
        employeeId: `STN${String(seq).padStart(4, '0')}`,
        firstName: p.name,
        workEmail: `${p.key}@${EMAIL_DOMAIN}`,
        joiningDate: dateOnly(JOINING_DATE),
        departmentId: deptIds.get(p.department),
        designationId: desigIds.get(p.designation),
        managerId: p.manager ? empIds.get(p.manager) : null,
        locationId: office!._id,
        shiftId: shift?._id ?? null,
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
      },
    ]);
    empIds.set(p.key, emp!._id);
    if (shift) {
      await ShiftAssignmentModel.create({ organizationId: orgId, employeeId: emp!._id, shiftId: shift._id, effectiveFrom: dateOnly(JOINING_DATE) });
    }
  }
  org.employeeSequence = seq;
  await org.save();

  for (const [code, key] of Object.entries(DEPARTMENT_HEADS)) {
    await DepartmentModel.updateOne({ _id: deptIds.get(code as DeptCode) }, { headId: empIds.get(key) });
  }

  // Head's login (Super Admin), linked to his employee record.
  const nitinId = empIds.get('nitin')!;
  const [admin] = await UserModel.create([
    {
      organizationId: orgId,
      employeeId: nitinId,
      email: STENCIL_ADMIN.email,
      passwordHash: await hashPassword(STENCIL_ADMIN.password),
      firstName: 'Nitin',
      roles: [roles.super_admin._id],
      status: 'ACTIVE',
      emailVerified: true,
      passwordChangedAt: new Date(),
    },
  ]);
  await EmployeeModel.updateOne({ _id: nitinId }, { userId: admin!._id });

  const year = Number(todayKey(TZ).slice(0, 4));
  for (const id of empIds.values()) {
    const emp = await EmployeeModel.findById(id).lean();
    if (emp) await ensureLeaveBalances(orgId, emp, year);
  }

  return { organizationId: String(orgId), employees: empIds.size, departments: deptIds.size, designations: desigIds.size };
};

export const printStencilSummary = (r: Awaited<ReturnType<typeof seedStencil>>) => {
  console.log(`\nStencil organization seeded: ${r.employees} employees, ${r.departments} departments, ${r.designations} designations.`);
  console.log(`Sign in as ${STENCIL_ADMIN.email} / ${STENCIL_ADMIN.password} (Super Admin, Nitin).`);
  console.log('Replace placeholder work emails and joining dates under People → Employees.\n');
};
