import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import type { EmployeeCreateInput, PaginationQuery } from '@stencil/shared';
import { employeeCreateSchema, employeeUpdateSchema, selfProfileUpdateSchema } from '@stencil/shared';
import type { z } from 'zod';
import { invalidateAuthCache } from '../middleware/auth';
import {
  DepartmentModel,
  DesignationModel,
  EmployeeHistoryModel,
  EmployeeModel,
  LocationModel,
  OnboardingTemplateModel,
  OrganizationModel,
  RoleModel,
  ShiftAssignmentModel,
  ShiftModel,
  UserModel,
  type Employee,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { decryptField, encryptField, maskValue } from '../utils/crypto';
import { dateOnly, todayKey } from '../utils/dates';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { audit, diff } from './audit.service';
import { issueActionToken, revokeAllSessions } from './auth.service';
import { sendEmail } from './email.service';
import { generateEmployeeCode } from './employee-code';
import { ensureLeaveBalances } from './leave-balance.service';
import { startOnboardingInSession } from './onboarding.service';
import { assertRefsInOrg } from './refs.service';
import { applyScope, assertEmployeeAccess, getReportIds, resolveEmployeeScope } from './scope.service';

type EmployeeListQuery = PaginationQuery & {
  department?: string;
  designation?: string;
  location?: string;
  manager?: string;
  status?: string;
  employmentType?: string;
  scope?: string;
};

const LIST_POPULATE = [
  { path: 'departmentId', select: 'name code' },
  { path: 'designationId', select: 'name code level' },
  { path: 'locationId', select: 'name city type' },
  { path: 'managerId', select: 'employeeId firstName lastName profilePhoto' },
];

/** Fields tracked in EmployeeHistory, mapped to history field names. */
const TRACKED: Record<string, { field: string; model?: { findById: (id: unknown) => { select: (s: string) => { lean: () => Promise<unknown> } } } }> = {
  departmentId: { field: 'department', model: DepartmentModel as never },
  designationId: { field: 'designation', model: DesignationModel as never },
  managerId: { field: 'manager', model: EmployeeModel as never },
  locationId: { field: 'location', model: LocationModel as never },
  shiftId: { field: 'shift', model: ShiftModel as never },
  employmentStatus: { field: 'status' },
  employmentType: { field: 'employmentType' },
};

const labelFor = async (key: string, value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const t = TRACKED[key];
  if (!t?.model) return String(value);
  const doc = (await t.model.findById(value).select('name firstName lastName employeeId').lean()) as
    | { name?: string; firstName?: string; lastName?: string; employeeId?: string }
    | null;
  if (!doc) return String(value);
  return doc.name ?? `${doc.firstName} ${doc.lastName} (${doc.employeeId})`;
};

const toDate = (v: unknown) => (typeof v === 'string' && v ? dateOnly(v) : v === null ? null : undefined);

/** Encrypts bank/identity details; returns the persisted shape. */
const buildSensitive = (input: { bank?: Record<string, unknown>; identity?: Record<string, string> }) => {
  const out: Record<string, unknown> = {};
  if (input.bank) {
    const { accountNumber, ...rest } = input.bank as { accountNumber?: string };
    out.bank = {
      ...rest,
      ...(accountNumber
        ? { accountNumberEncrypted: encryptField(accountNumber), accountNumberMasked: maskValue(accountNumber) }
        : {}),
    };
  }
  if (input.identity) {
    out.identity = Object.fromEntries(
      Object.entries(input.identity)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, encryptField(v)]),
    );
  }
  return out;
};

type EmployeeLean = Employee & { _id: Types.ObjectId; bank?: Record<string, unknown>; identity?: Map<string, string> | Record<string, string> };

/**
 * Serializes an employee for the viewer. Sensitive details are decrypted only
 * for the employee themself or holders of `employee:read_sensitive`; others
 * get masked values. Team managers get a reduced personal view.
 */
const serialize = (emp: EmployeeLean, access: 'self' | 'all' | 'team', ctx: RequestContext) => {
  const full = access === 'self' || can(ctx, 'employee:read_sensitive');
  const { bank, identity, ...rest } = emp as EmployeeLean & Record<string, unknown>;
  const identityEntries = identity ? Object.entries(identity instanceof Map ? Object.fromEntries(identity) : identity) : [];
  const out: Record<string, unknown> = { ...rest };
  if (access === 'team') {
    for (const k of ['dateOfBirth', 'weddingAnniversary', 'maritalStatus', 'personalEmail', 'address', 'postalCode', 'bloodGroup']) delete out[k];
  }
  if (access !== 'team') {
    out.bank = bank
      ? {
          bankName: bank.bankName,
          accountHolderName: bank.accountHolderName,
          ifsc: bank.ifsc,
          branch: bank.branch,
          accountNumber: full ? decryptField(bank.accountNumberEncrypted as string) : undefined,
          accountNumberMasked: bank.accountNumberMasked,
        }
      : null;
    out.identity = Object.fromEntries(
      identityEntries.map(([k, v]) => {
        const plain = decryptField(v);
        return [k, full ? plain : maskValue(plain)];
      }),
    );
  }
  out.sensitiveVisible = full;
  return out;
};

/* ------------------------------- Queries ------------------------------ */

export const listEmployees = async (ctx: RequestContext, q: EmployeeListQuery) => {
  const scope = await resolveEmployeeScope(ctx, 'employee:read', q.scope);
  const filter: FilterQuery<Employee> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...searchFilter(q.search, ['firstName', 'lastName', 'employeeId', 'workEmail', 'phone']),
  };
  const idOrCode = async (value: string | undefined, model: { findOne: (f: object) => { select: (s: string) => { lean: () => Promise<{ _id: Types.ObjectId } | null> } } }) => {
    if (!value) return undefined;
    if (Types.ObjectId.isValid(value)) return new Types.ObjectId(value);
    const doc = await model.findOne({ organizationId: ctx.organizationId, code: value.toUpperCase() }).select('_id').lean();
    return doc?._id ?? new Types.ObjectId();
  };
  const dept = await idOrCode(q.department, DepartmentModel as never);
  if (dept) filter.departmentId = dept;
  const desig = await idOrCode(q.designation, DesignationModel as never);
  if (desig) filter.designationId = desig;
  if (q.location && Types.ObjectId.isValid(q.location)) filter.locationId = new Types.ObjectId(q.location);
  if (q.manager && Types.ObjectId.isValid(q.manager)) filter.managerId = new Types.ObjectId(q.manager);
  if (q.employmentType) filter.employmentType = q.employmentType;
  filter.employmentStatus = q.status ? q.status : { $nin: ['EXITED', 'ARCHIVED'] };

  return paginate(EmployeeModel, {
    filter: applyScope(filter, scope, '_id'),
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['firstName', 'lastName', 'employeeId', 'joiningDate', 'createdAt', 'employmentStatus'], { firstName: 1, lastName: 1 }),
    populate: LIST_POPULATE,
    select: '-emergencyContact',
  });
};

/** Minimal directory for pickers & people search; visible to every employee. */
export const directory = async (ctx: RequestContext, q: { search?: string; limit?: number; includeExited?: boolean }) =>
  EmployeeModel.find({
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(q.includeExited ? {} : { employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } }),
    ...searchFilter(q.search, ['firstName', 'lastName', 'employeeId', 'workEmail']),
  })
    .select('employeeId firstName lastName profilePhoto workEmail departmentId designationId managerId userId employmentStatus')
    .populate([{ path: 'departmentId', select: 'name' }, { path: 'designationId', select: 'name' }])
    .sort({ firstName: 1 })
    .limit(Math.min(q.limit ?? 50, 200))
    .lean();

export const getEmployee = async (ctx: RequestContext, id: string) => {
  const access = await assertEmployeeAccess(ctx, id, 'employee:read');
  const emp = await EmployeeModel.findOne({ _id: id, organizationId: ctx.organizationId })
    .select('+bank +identity')
    .populate([...LIST_POPULATE, { path: 'shiftId', select: 'name code startTime endTime' }, { path: 'userId', select: 'email status lastLoginAt roles' }])
    .lean();
  if (!emp) throw notFound('Employee');
  const reportCount = await EmployeeModel.countDocuments({ organizationId: ctx.organizationId, managerId: emp._id, deletedAt: null });
  return { ...serialize(emp as unknown as EmployeeLean, access, ctx), directReportCount: reportCount };
};

export const getHistory = async (ctx: RequestContext, id: string) => {
  await assertEmployeeAccess(ctx, id, 'employee:read');
  return EmployeeHistoryModel.find({ organizationId: ctx.organizationId, employeeId: id })
    .sort({ createdAt: -1 })
    .populate({ path: 'changedBy', select: 'firstName lastName' })
    .limit(200)
    .lean();
};

export const getTeam = async (ctx: RequestContext) => {
  if (!ctx.employeeId) return [];
  return EmployeeModel.find({ organizationId: ctx.organizationId, managerId: ctx.employeeId, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } })
    .populate(LIST_POPULATE)
    .sort({ firstName: 1 })
    .lean();
};

/** An employee's own team: their manager and the colleagues who report to the same manager (directory fields only). */
export const getTeammates = async (ctx: RequestContext) => {
  if (!ctx.employeeId) return { manager: null, teammates: [] };
  const me = await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId }).select('managerId').lean();
  if (!me?.managerId) return { manager: null, teammates: [] };
  const fields = 'employeeId firstName lastName profilePhoto workEmail departmentId designationId';
  const populate = [{ path: 'departmentId', select: 'name' }, { path: 'designationId', select: 'name' }];
  const [manager, teammates] = await Promise.all([
    EmployeeModel.findOne({ _id: me.managerId, organizationId: ctx.organizationId, deletedAt: null }).select(fields).populate(populate).lean(),
    EmployeeModel.find({
      organizationId: ctx.organizationId,
      managerId: me.managerId,
      _id: { $ne: ctx.employeeId },
      deletedAt: null,
      employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
    })
      .select(fields)
      .populate(populate)
      .sort({ firstName: 1 })
      .limit(200)
      .lean(),
  ]);
  return { manager, teammates };
};

export const orgChart = async (ctx: RequestContext) => {
  const people = await EmployeeModel.find({ organizationId: ctx.organizationId, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } })
    .select('employeeId firstName lastName profilePhoto managerId designationId departmentId')
    .populate([{ path: 'designationId', select: 'name' }, { path: 'departmentId', select: 'name' }])
    .lean();
  type Node = (typeof people)[number] & { children: Node[] };
  const map = new Map<string, Node>(people.map((p) => [String(p._id), { ...p, children: [] }]));
  const roots: Node[] = [];
  for (const node of map.values()) {
    const parent = node.managerId ? map.get(String(node.managerId)) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
};

/* ------------------------------ Mutations ----------------------------- */

const assertManagerValid = async (ctx: RequestContext, employeeId: Types.ObjectId | null, managerId: unknown) => {
  if (!managerId) return;
  if (employeeId && String(managerId) === String(employeeId)) throw badRequest('An employee cannot be their own manager', 'INVALID_MANAGER');
  if (employeeId) {
    const reports = await getReportIds(ctx.organizationId, employeeId);
    if (reports.some((r) => r.equals(String(managerId)))) {
      throw badRequest('The selected manager reports to this employee', 'HIERARCHY_CYCLE');
    }
  }
};

const recordHistory = async (
  ctx: RequestContext,
  employeeId: Types.ObjectId,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  effectiveDate: Date,
  reason: string | undefined,
  session?: ClientSession,
) => {
  const entries = [];
  for (const [key, def] of Object.entries(TRACKED)) {
    if (!(key in after)) continue;
    const oldV = before[key] ?? null;
    const newV = after[key] ?? null;
    if (String(oldV ?? '') === String(newV ?? '')) continue;
    entries.push({
      organizationId: ctx.organizationId,
      employeeId,
      field: def.field,
      oldValue: oldV,
      newValue: newV,
      oldLabel: await labelFor(key, oldV),
      newLabel: await labelFor(key, newV),
      effectiveDate,
      reason,
      changedBy: ctx.userId,
    });
  }
  if (entries.length) await EmployeeHistoryModel.insertMany(entries, { session });
  return entries;
};

export const createEmployee = async (ctx: RequestContext, raw: EmployeeCreateInput) => {
  const input = employeeCreateSchema.parse(raw);
  await assertRefsInOrg(ctx.organizationId, input, ['departmentId', 'designationId', 'managerId', 'locationId', 'shiftId']);
  if (await EmployeeModel.exists({ organizationId: ctx.organizationId, workEmail: input.workEmail })) {
    throw conflict('An employee with this work email already exists', 'EMAIL_TAKEN');
  }
  if (input.createUserAccount && (await UserModel.exists({ email: input.workEmail }))) {
    throw conflict('A user account with this work email already exists', 'EMAIL_TAKEN');
  }
  if ((input.bank || input.identity) && !can(ctx, 'employee:read_sensitive')) {
    throw forbidden('You are not allowed to set bank or identity details');
  }
  const extraRoles = input.roleIds?.length
    ? await RoleModel.find({ _id: { $in: input.roleIds }, organizationId: ctx.organizationId }).lean()
    : [];
  const grants = extraRoles.flatMap((r) => r.permissions);
  if (grants.some((p) => !ctx.permissions.has(p as never)) || (extraRoles.length && !can(ctx, 'user:manage'))) {
    throw forbidden('You cannot assign roles with permissions you do not have');
  }
  if (extraRoles.some((r) => r.key === 'super_admin') && !ctx.roleKeys.includes('super_admin')) {
    throw forbidden('Only a Super Admin can give someone the Super Admin role', 'SUPER_ADMIN_ONLY');
  }

  const org = await OrganizationModel.findById(ctx.organizationId).select('timezone name').lean();
  const { employee, userId } = await withTransaction(async (session) => {
    const code = input.employeeId ?? (await generateEmployeeCode(ctx.organizationId, session));
    if (input.employeeId && (await EmployeeModel.exists({ organizationId: ctx.organizationId, employeeId: code }).session(session ?? null))) {
      throw conflict('Employee ID is already in use');
    }
    const shiftId = input.shiftId ?? (await ShiftModel.findOne({ organizationId: ctx.organizationId, isDefault: true, deletedAt: null }).select('_id').lean())?._id ?? null;

    const {
      createUserAccount,
      roleIds: _roles,
      onboardingTemplateId,
      bank,
      identity,
      joiningDate,
      confirmationDate,
      dateOfBirth,
      employeeId: _code,
      ...fields
    } = input;
    void _roles;
    void _code;
    const [employee] = await EmployeeModel.create(
      [
        {
          ...fields,
          ...buildSensitive({ bank, identity }),
          organizationId: ctx.organizationId,
          employeeId: code,
          shiftId,
          joiningDate: dateOnly(joiningDate),
          confirmationDate: toDate(confirmationDate) ?? null,
          dateOfBirth: toDate(dateOfBirth),
        },
      ],
      { session },
    );

    if (shiftId) {
      await ShiftAssignmentModel.create(
        [{ organizationId: ctx.organizationId, employeeId: employee!._id, shiftId, effectiveFrom: dateOnly(joiningDate), assignedBy: ctx.userId }],
        { session },
      );
    }

    let userId: Types.ObjectId | null = null;
    if (createUserAccount) {
      const employeeRole = await RoleModel.findOne({ organizationId: ctx.organizationId, key: 'employee' }).select('_id').lean();
      const roleIds = [...new Set([employeeRole?._id, ...extraRoles.map((r) => r._id)].filter(Boolean).map(String))];
      const [user] = await UserModel.create(
        [
          {
            organizationId: ctx.organizationId,
            employeeId: employee!._id,
            email: input.workEmail,
            firstName: input.firstName,
            lastName: input.lastName,
            roles: roleIds,
            status: 'ACTIVE',
          },
        ],
        { session },
      );
      userId = user!._id;
      employee!.userId = userId;
      await employee!.save({ session });
    }

    await ensureLeaveBalances(ctx.organizationId, employee!, Number(todayKey(org?.timezone ?? 'UTC').slice(0, 4)), session);

    const template =
      (onboardingTemplateId && (await OnboardingTemplateModel.findOne({ _id: onboardingTemplateId, organizationId: ctx.organizationId, deletedAt: null }).session(session ?? null))) ||
      (await OnboardingTemplateModel.findOne({ organizationId: ctx.organizationId, isDefault: true, deletedAt: null }).session(session ?? null));
    if (template) await startOnboardingInSession(ctx, employee!, template, joiningDate, session);

    return { employee: employee!, userId };
  });

  if (userId) {
    const token = await issueActionToken(userId, 'INVITE');
    await sendEmail(input.workEmail, 'invite', { name: input.firstName, organization: org?.name ?? 'your organization', token }, ctx.organizationId);
  }
  await audit(ctx, {
    action: 'EMPLOYEE_CREATED',
    module: 'employees',
    recordId: employee._id,
    recordLabel: `${employee.firstName} ${employee.lastName} (${employee.employeeId})`,
    newValues: { employeeId: employee.employeeId, workEmail: employee.workEmail, departmentId: employee.departmentId, designationId: employee.designationId },
  });
  return getEmployee(ctx, String(employee._id));
};

export const updateEmployee = async (ctx: RequestContext, id: string, input: z.output<typeof employeeUpdateSchema>) => {
  const emp = await EmployeeModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).select('+bank +identity');
  if (!emp) throw notFound('Employee');
  await assertRefsInOrg(ctx.organizationId, input, ['departmentId', 'designationId', 'managerId', 'locationId', 'shiftId']);
  await assertManagerValid(ctx, emp._id, input.managerId);
  if ((input.bank || input.identity) && !can(ctx, 'employee:read_sensitive')) {
    throw forbidden('You are not allowed to change bank or identity details');
  }
  if (input.workEmail && input.workEmail !== emp.workEmail) {
    if (await EmployeeModel.exists({ organizationId: ctx.organizationId, workEmail: input.workEmail, _id: { $ne: emp._id } })) {
      throw conflict('Another employee uses this work email', 'EMAIL_TAKEN');
    }
  }
  if (input.employmentStatus === 'EXITED' && emp.employmentStatus !== 'EXITED') {
    throw unprocessable('Use the offboarding workflow to exit an employee', 'USE_OFFBOARDING');
  }

  const { changeReason, effectiveDate, bank, identity, joiningDate, confirmationDate, dateOfBirth, ...fields } = input;
  const before = emp.toObject() as unknown as Record<string, unknown>;
  const org = await OrganizationModel.findById(ctx.organizationId).select('timezone').lean();
  const eff = dateOnly(effectiveDate ?? todayKey(org?.timezone ?? 'UTC'));

  await withTransaction(async (session) => {
    emp.set(fields);
    if (joiningDate) emp.joiningDate = dateOnly(joiningDate);
    if (confirmationDate !== undefined) emp.confirmationDate = toDate(confirmationDate) as Date | null;
    if (dateOfBirth !== undefined) emp.set('dateOfBirth', toDate(dateOfBirth));
    const sensitive = buildSensitive({ bank: bank as Record<string, unknown> | undefined, identity: identity as Record<string, string> | undefined });
    if (sensitive.bank) {
      const prev = (before.bank ?? {}) as Record<string, unknown>;
      emp.set('bank', { ...prev, ...(sensitive.bank as object) });
    }
    if (sensitive.identity) {
      const prev = before.identity instanceof Map ? Object.fromEntries(before.identity) : ((before.identity as object) ?? {});
      emp.set('identity', { ...prev, ...(sensitive.identity as object) });
    }
    await emp.save({ session });

    await recordHistory(ctx, emp._id, before, fields as Record<string, unknown>, eff, changeReason, session);

    if (fields.shiftId !== undefined && String(fields.shiftId ?? '') !== String(before.shiftId ?? '')) {
      await ShiftAssignmentModel.updateMany(
        { organizationId: ctx.organizationId, employeeId: emp._id, effectiveTo: null },
        { effectiveTo: eff },
        { session },
      );
      if (fields.shiftId) {
        await ShiftAssignmentModel.create(
          [{ organizationId: ctx.organizationId, employeeId: emp._id, shiftId: fields.shiftId, effectiveFrom: eff, assignedBy: ctx.userId }],
          { session },
        );
      }
    }
    if (fields.firstName || fields.lastName) {
      await UserModel.updateOne({ _id: emp.userId }, { firstName: emp.firstName, lastName: emp.lastName }, { session });
    }
  });

  if (input.managerId !== undefined) invalidateAuthCache();
  const changes = diff(before, { ...fields, ...(bank ? { bank: '[changed]' } : {}), ...(identity ? { identity: '[changed]' } : {}) });
  await audit(ctx, {
    action: 'EMPLOYEE_UPDATED',
    module: 'employees',
    recordId: emp._id,
    recordLabel: `${emp.firstName} ${emp.lastName} (${emp.employeeId})`,
    ...changes,
  });
  return getEmployee(ctx, id);
};

export const updateOwnProfile = async (ctx: RequestContext, input: z.infer<typeof selfProfileUpdateSchema>) => {
  if (!ctx.employeeId) throw notFound('Employee profile');
  const emp = await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId });
  if (!emp) throw notFound('Employee');
  const before = emp.toObject() as unknown as Record<string, unknown>;
  emp.set(input);
  await emp.save();
  await audit(ctx, { action: 'EMPLOYEE_UPDATED', module: 'employees', recordId: emp._id, recordLabel: 'self-service', ...diff(before, input as Record<string, unknown>) });
  return getEmployee(ctx, String(emp._id));
};

export const archiveEmployee = async (ctx: RequestContext, id: string) => {
  const emp = await EmployeeModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!emp) throw notFound('Employee');
  if (ctx.employeeId?.equals(emp._id)) throw forbidden('You cannot archive yourself');
  const reports = await EmployeeModel.countDocuments({ organizationId: ctx.organizationId, managerId: emp._id, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } });
  if (reports) throw unprocessable(`Reassign ${reports} direct report(s) before archiving`, 'HAS_REPORTS');
  const before = { employmentStatus: emp.employmentStatus };
  emp.employmentStatus = 'ARCHIVED';
  emp.deletedAt = new Date();
  await emp.save();
  await EmployeeHistoryModel.create({
    organizationId: ctx.organizationId,
    employeeId: emp._id,
    field: 'status',
    oldValue: before.employmentStatus,
    newValue: 'ARCHIVED',
    oldLabel: before.employmentStatus,
    newLabel: 'ARCHIVED',
    effectiveDate: new Date(),
    changedBy: ctx.userId,
  });
  if (emp.userId) {
    await UserModel.updateOne({ _id: emp.userId }, { status: 'INACTIVE' });
    await revokeAllSessions(emp.userId);
  }
  await audit(ctx, {
    action: 'EMPLOYEE_ARCHIVED',
    module: 'employees',
    recordId: emp._id,
    recordLabel: `${emp.firstName} ${emp.lastName} (${emp.employeeId})`,
    oldValues: before,
    newValues: { employmentStatus: 'ARCHIVED' },
  });
};

export const setProfilePhoto = async (ctx: RequestContext, employeeId: string, documentId: string) => {
  const emp = await EmployeeModel.findOneAndUpdate(
    { _id: employeeId, organizationId: ctx.organizationId },
    { profilePhoto: `/api/v1/files/${documentId}` },
    { new: true },
  );
  if (!emp) throw notFound('Employee');
  if (emp.userId) await UserModel.updateOne({ _id: emp.userId }, { avatar: emp.profilePhoto });
  return { profilePhoto: emp.profilePhoto };
};

/** Records a salary change in the employment history (called by the salary service). */
export const recordSalaryHistory = async (
  ctx: RequestContext,
  employeeId: Types.ObjectId,
  oldCtc: number,
  newCtc: number,
  effectiveDate: Date,
  reason: string,
  session?: ClientSession,
) => {
  await EmployeeHistoryModel.create(
    [
      {
        organizationId: ctx.organizationId,
        employeeId,
        field: 'salary',
        oldValue: oldCtc,
        newValue: newCtc,
        oldLabel: oldCtc ? String(oldCtc) : null,
        newLabel: String(newCtc),
        effectiveDate,
        reason,
        changedBy: ctx.userId,
      },
    ],
    { session },
  );
};
