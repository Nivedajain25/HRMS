import { Types, type ClientSession } from 'mongoose';
import type { PaginationQuery, Weekday } from '@stencil/shared';
import { shiftAssignmentSchema, shiftSchema, shiftUpdateSchema } from '@stencil/shared';
import type { z } from 'zod';
import {
  EmployeeHistoryModel,
  EmployeeModel,
  OrganizationModel,
  ShiftAssignmentModel,
  ShiftModel,
  type Shift,
} from '../models';
import type { RequestContext } from '../types/context';
import { dateOnly, eachDateKey, todayKey, weekdayOf } from '../utils/dates';
import { badRequest, conflict, notFound, unprocessable } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { fallbackShift, spansMidnight } from './attendance-calc';
import { audit, diff } from './audit.service';
import { holidaysInRange } from './calendar.service';
import { createCrudService } from './crud.service';
import { assertIdsInOrg, assertRefsInOrg } from './refs.service';
import { applyScope, assertEmployeeAccess, resolveEmployeeScope } from './scope.service';

/* --------------------------- Org settings ---------------------------- */

export interface AttendanceSettings {
  allowRemoteClockIn: boolean;
  halfDayThresholdHours: number;
  overtimeAfterHours: number;
  autoMarkAbsent: boolean;
  defaultShiftStart: string;
  defaultShiftEnd: string;
  requireSelfie: boolean;
  requireLocation: boolean;
  allowBreaks: boolean;
}

export interface OrgAttendanceConfig {
  timezone: string;
  workingDays: Weekday[];
  attendance: AttendanceSettings;
  regularizationChain: ('MANAGER' | 'HR' | 'FINANCE' | 'PAYROLL')[];
}

export const loadOrgAttendanceConfig = async (organizationId: Types.ObjectId): Promise<OrgAttendanceConfig> => {
  const org = await OrganizationModel.findById(organizationId).select('timezone workingDays settings').lean();
  const a = org?.settings?.attendance;
  return {
    timezone: org?.timezone ?? 'UTC',
    workingDays: (org?.workingDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI']) as Weekday[],
    attendance: {
      allowRemoteClockIn: a?.allowRemoteClockIn ?? true,
      halfDayThresholdHours: a?.halfDayThresholdHours ?? 4,
      overtimeAfterHours: a?.overtimeAfterHours ?? 9,
      autoMarkAbsent: a?.autoMarkAbsent ?? true,
      defaultShiftStart: a?.defaultShiftStart ?? '09:00',
      defaultShiftEnd: a?.defaultShiftEnd ?? '18:00',
      requireSelfie: a?.requireSelfie ?? false,
      requireLocation: a?.requireLocation ?? false,
      allowBreaks: a?.allowBreaks ?? false,
    },
    regularizationChain: ((org?.settings?.approvals?.regularization as string[] | undefined) ?? ['MANAGER', 'HR']) as OrgAttendanceConfig['regularizationChain'],
  };
};

/* --------------------------- Shift resolution ------------------------ */

export interface ResolvedShift {
  _id: Types.ObjectId | null;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  workingHours: number;
  halfDayHours: number;
  nightShift: boolean;
  flexible: boolean;
  color: string;
  isDefault: boolean;
}

type ShiftLean = Shift & { _id: Types.ObjectId };

const toResolved = (s: ShiftLean): ResolvedShift => ({
  _id: s._id,
  name: s.name,
  code: s.code,
  startTime: s.startTime,
  endTime: s.endTime,
  gracePeriodMinutes: s.gracePeriodMinutes ?? 0,
  breakDurationMinutes: s.breakDurationMinutes ?? 0,
  workingHours: s.workingHours ?? 8,
  halfDayHours: s.halfDayHours ?? 0,
  nightShift: !!s.nightShift || spansMidnight(s),
  flexible: !!s.flexible,
  color: s.color ?? '#6366f1',
  isDefault: !!s.isDefault,
});

interface EmployeeShiftRef {
  _id: Types.ObjectId;
  shiftId?: Types.ObjectId | null;
}

/**
 * Resolves the shift of each employee for each date in [from, to]:
 * active ShiftAssignment (effectiveFrom <= date < effectiveTo) → employee.shiftId
 * → organization default shift → settings.attendance default times.
 */
export const resolveShiftsForRange = async (
  organizationId: Types.ObjectId,
  employees: EmployeeShiftRef[],
  from: string,
  to: string,
  settings: AttendanceSettings,
  session?: ClientSession,
): Promise<Map<string, Map<string, ResolvedShift>>> => {
  const empIds = employees.map((e) => e._id);
  const [shifts, assignments] = await Promise.all([
    ShiftModel.find({ organizationId }).session(session ?? null).lean(),
    empIds.length
      ? ShiftAssignmentModel.find({
          organizationId,
          employeeId: { $in: empIds },
          effectiveFrom: { $lte: dateOnly(to) },
          $or: [{ effectiveTo: null }, { effectiveTo: { $gt: dateOnly(from) } }],
        })
          .session(session ?? null)
          .sort({ effectiveFrom: -1 })
          .lean()
      : [],
  ]);
  const byId = new Map(shifts.map((s) => [String(s._id), toResolved(s as ShiftLean)]));
  const def = shifts.find((s) => s.isDefault && !s.deletedAt);
  const fallback: ResolvedShift = def ? toResolved(def as ShiftLean) : fallbackShift(settings);
  const asgByEmp = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const k = String(a.employeeId);
    const list = asgByEmp.get(k) ?? [];
    list.push(a);
    asgByEmp.set(k, list);
  }

  const days = eachDateKey(from, to);
  const out = new Map<string, Map<string, ResolvedShift>>();
  for (const emp of employees) {
    const list = asgByEmp.get(String(emp._id)) ?? [];
    const own = emp.shiftId ? byId.get(String(emp.shiftId)) : undefined;
    const perDay = new Map<string, ResolvedShift>();
    for (const day of days) {
      const d = dateOnly(day);
      // Sorted by effectiveFrom desc: the first match is the most recent assignment.
      const asg = list.find((a) => a.effectiveFrom <= d && (!a.effectiveTo || a.effectiveTo > d));
      const shift = (asg && byId.get(String(asg.shiftId))) || own || fallback;
      perDay.set(day, shift);
    }
    out.set(String(emp._id), perDay);
  }
  return out;
};

export const resolveShift = async (
  organizationId: Types.ObjectId,
  employee: EmployeeShiftRef,
  dateKey: string,
  settings: AttendanceSettings,
  session?: ClientSession,
): Promise<ResolvedShift> => {
  const map = await resolveShiftsForRange(organizationId, [employee], dateKey, dateKey, settings, session);
  return map.get(String(employee._id))!.get(dateKey)!;
};

/* -------------------------------- CRUD -------------------------------- */

const crud = createCrudService({
  model: ShiftModel,
  entity: 'Shift',
  module: 'shifts',
  searchFields: ['name', 'code'],
  sortFields: ['name', 'code', 'startTime', 'createdAt'],
  defaultSort: { name: 1 },
  label: (d) => `${String(d.name)} (${String(d.code)})`,
  beforeDelete: async (ctx, id) => {
    const shift = await ShiftModel.findOne({ _id: id, organizationId: ctx.organizationId }).select('isDefault').lean();
    if (shift?.isDefault) throw unprocessable('The default shift cannot be deleted', 'SHIFT_IS_DEFAULT');
    const today = dateOnly(todayKey(ctx.timezone));
    const open = await ShiftAssignmentModel.countDocuments({
      organizationId: ctx.organizationId,
      shiftId: id,
      $or: [{ effectiveTo: null }, { effectiveTo: { $gt: today } }],
    });
    if (open) throw unprocessable(`This shift has ${open} active assignment(s); reassign them first`, 'SHIFT_IN_USE');
    const employees = await EmployeeModel.countDocuments({ organizationId: ctx.organizationId, shiftId: id, deletedAt: null });
    if (employees) throw unprocessable(`This shift is assigned to ${employees} employee(s); reassign them first`, 'SHIFT_IN_USE');
  },
});

export const listShifts = async (ctx: RequestContext, q: PaginationQuery) => {
  const page = await crud.list(ctx, q);
  const counts = await EmployeeModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
        shiftId: { $in: page.items.map((s) => s._id) },
      },
    },
    { $group: { _id: '$shiftId', count: { $sum: 1 } } },
  ]);
  const byShift = new Map(counts.map((c) => [String(c._id), c.count]));
  return { items: page.items.map((s) => ({ ...s, employeeCount: byShift.get(String(s._id)) ?? 0 })), pagination: page.pagination };
};

export const allShifts = (ctx: RequestContext) => crud.all(ctx);
export const getShift = (ctx: RequestContext, id: string) => crud.get(ctx, id);

type ShiftCreate = z.output<typeof shiftSchema>;
type ShiftUpdate = z.output<typeof shiftUpdateSchema>;

const assertCodeFree = async (ctx: RequestContext, code: string, exceptId?: string) => {
  const exists = await ShiftModel.exists({ organizationId: ctx.organizationId, code, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (exists) throw conflict('A shift with this code already exists', 'SHIFT_CODE_TAKEN');
};

export const createShift = async (ctx: RequestContext, input: ShiftCreate) => {
  await assertCodeFree(ctx, input.code);
  const data = { ...input, nightShift: input.nightShift || spansMidnight(input) };
  const shift = await withTransaction(async (session) => {
    if (data.isDefault) {
      await ShiftModel.updateMany({ organizationId: ctx.organizationId, isDefault: true }, { isDefault: false }, { session });
    }
    const [doc] = await ShiftModel.create([{ ...data, organizationId: ctx.organizationId }], { session });
    return doc!;
  });
  await audit(ctx, { action: 'RECORD_CREATED', module: 'shifts', recordId: shift._id, recordLabel: `${shift.name} (${shift.code})`, newValues: data });
  return shift.toJSON();
};

export const updateShift = async (ctx: RequestContext, id: string, input: ShiftUpdate) => {
  const shift = await ShiftModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!shift) throw notFound('Shift');
  if (input.code && input.code !== shift.code) await assertCodeFree(ctx, input.code, id);
  if (input.isDefault === false && shift.isDefault) {
    throw unprocessable('Mark another shift as default instead of unsetting the default', 'DEFAULT_SHIFT_REQUIRED');
  }
  const before = shift.toObject() as unknown as Record<string, unknown>;
  const startTime = input.startTime ?? shift.startTime;
  const endTime = input.endTime ?? shift.endTime;
  const data: Record<string, unknown> = { ...input };
  if (input.startTime || input.endTime || input.nightShift !== undefined) {
    // Omitted flag keeps the stored value; times spanning midnight always imply a night shift.
    data.nightShift = (input.nightShift ?? shift.nightShift) || spansMidnight({ startTime, endTime });
  }
  await withTransaction(async (session) => {
    if (input.isDefault && !shift.isDefault) {
      await ShiftModel.updateMany({ organizationId: ctx.organizationId, isDefault: true, _id: { $ne: shift._id } }, { isDefault: false }, { session });
    }
    shift.set(data);
    await shift.save({ session });
  });
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'shifts', recordId: shift._id, recordLabel: `${shift.name} (${shift.code})`, ...diff(before, data) });
  return shift.toJSON();
};

export const removeShift = (ctx: RequestContext, id: string) => crud.remove(ctx, id);

/* ----------------------------- Assignment ----------------------------- */

type AssignInput = z.output<typeof shiftAssignmentSchema>;

export const assignShift = async (ctx: RequestContext, input: AssignInput) => {
  const shift = await ShiftModel.findOne({ _id: input.shiftId, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!shift) throw notFound('Shift');
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
    throw badRequest('Effective to must be after effective from', 'VALIDATION_ERROR', [{ path: 'effectiveTo', message: 'Must be after effective from' }]);
  }
  const ids = new Set<string>(input.employeeIds ?? []);
  if (input.employeeIds?.length) await assertIdsInOrg(ctx.organizationId, EmployeeModel as never, input.employeeIds, 'employees');
  if (input.departmentId) {
    await assertRefsInOrg(ctx.organizationId, { departmentId: input.departmentId }, ['departmentId']);
    const members = await EmployeeModel.find({
      organizationId: ctx.organizationId,
      departmentId: input.departmentId,
      deletedAt: null,
      employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
    })
      .select('_id')
      .lean();
    for (const m of members) ids.add(String(m._id));
  }
  const employees = await EmployeeModel.find({ organizationId: ctx.organizationId, _id: { $in: [...ids] }, deletedAt: null })
    .select('_id shiftId firstName lastName employeeId')
    .lean();
  if (!employees.length) throw badRequest('No employees to assign', 'NO_EMPLOYEES');

  const today = todayKey(ctx.timezone);
  const from = dateOnly(input.effectiveFrom);
  const to = input.effectiveTo ? dateOnly(input.effectiveTo) : null;
  const applyNow = input.effectiveFrom <= today && (!input.effectiveTo || input.effectiveTo > today);
  const shiftNames = new Map(
    (await ShiftModel.find({ organizationId: ctx.organizationId }).select('name').lean()).map((s) => [String(s._id), s.name]),
  );

  await withTransaction(async (session) => {
    for (const emp of employees) {
      // Future assignments starting on/after the new one are superseded.
      await ShiftAssignmentModel.deleteMany({ organizationId: ctx.organizationId, employeeId: emp._id, effectiveFrom: { $gte: from } }, { session });
      // Close the currently open assignment at the new effective date.
      await ShiftAssignmentModel.updateMany(
        { organizationId: ctx.organizationId, employeeId: emp._id, effectiveFrom: { $lt: from }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: from } }] },
        { effectiveTo: from },
        { session },
      );
      await ShiftAssignmentModel.create(
        [{ organizationId: ctx.organizationId, employeeId: emp._id, shiftId: shift._id, effectiveFrom: from, effectiveTo: to, assignedBy: ctx.userId }],
        { session },
      );
      if (applyNow && String(emp.shiftId ?? '') !== String(shift._id)) {
        await EmployeeModel.updateOne({ _id: emp._id, organizationId: ctx.organizationId }, { shiftId: shift._id }, { session });
      }
      await EmployeeHistoryModel.create(
        [
          {
            organizationId: ctx.organizationId,
            employeeId: emp._id,
            field: 'shift',
            oldValue: emp.shiftId ?? null,
            newValue: shift._id,
            oldLabel: emp.shiftId ? (shiftNames.get(String(emp.shiftId)) ?? null) : null,
            newLabel: shift.name,
            effectiveDate: from,
            reason: input.effectiveTo ? `Temporary shift assignment until ${input.effectiveTo}` : 'Shift assignment',
            changedBy: ctx.userId,
          },
        ],
        { session },
      );
    }
  });

  await audit(ctx, {
    action: 'RECORD_CREATED',
    module: 'shifts',
    recordId: shift._id,
    recordLabel: `Shift assignment: ${shift.name}`,
    newValues: { shiftId: shift._id, employeeIds: employees.map((e) => e._id), effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null },
  });
  return { shiftId: shift._id, assigned: employees.length, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, appliedToProfile: applyNow };
};

export const listAssignments = async (
  ctx: RequestContext,
  q: PaginationQuery & { employeeId?: string; shiftId?: string },
) => {
  const filter: Record<string, unknown> = { organizationId: ctx.organizationId };
  if (q.shiftId) filter.shiftId = new Types.ObjectId(q.shiftId);
  if (q.employeeId) {
    await assertEmployeeAccess(ctx, q.employeeId, 'attendance:read');
    filter.employeeId = new Types.ObjectId(q.employeeId);
  } else {
    const scope = await resolveEmployeeScope(ctx, 'attendance:read');
    if (scope.employeeIds !== null) filter.employeeId = { $in: scope.employeeIds };
  }
  const [items, total] = await Promise.all([
    ShiftAssignmentModel.find(filter)
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate([
        { path: 'shiftId', select: 'name code startTime endTime color' },
        { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' },
        { path: 'assignedBy', select: 'firstName lastName' },
      ])
      .lean(),
    ShiftAssignmentModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

/* ------------------------------ Schedule ------------------------------ */

export const getSchedule = async (ctx: RequestContext, q: { from: string; to: string; departmentId?: string }) => {
  const days = eachDateKey(q.from, q.to);
  if (days.length > 31) throw badRequest('The schedule range is limited to 31 days', 'RANGE_TOO_LARGE');
  const scope = await resolveEmployeeScope(ctx, 'attendance:read');
  if (q.departmentId) await assertRefsInOrg(ctx.organizationId, { departmentId: q.departmentId }, ['departmentId']);
  const filter = applyScope(
    {
      organizationId: ctx.organizationId,
      deletedAt: null,
      employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
      ...(q.departmentId ? { departmentId: new Types.ObjectId(q.departmentId) } : {}),
    },
    scope,
    '_id',
  );
  const employees = await EmployeeModel.find(filter)
    .select('employeeId firstName lastName profilePhoto departmentId shiftId locationId')
    .populate({ path: 'departmentId', select: 'name' })
    .sort({ firstName: 1, lastName: 1 })
    .limit(500)
    .lean();
  const cfg = await loadOrgAttendanceConfig(ctx.organizationId);
  const refs = employees.map((e) => ({ _id: e._id, shiftId: e.shiftId }));
  const shifts = await resolveShiftsForRange(ctx.organizationId, refs, q.from, q.to, cfg.attendance);

  const holidayCache = new Map<string, Map<string, { name: string; optional: boolean }>>();
  const holidaysFor = async (locationId: Types.ObjectId | null | undefined) => {
    const key = String(locationId ?? '');
    let map = holidayCache.get(key);
    if (!map) {
      map = await holidaysInRange(ctx.organizationId, q.from, q.to, locationId ?? null);
      holidayCache.set(key, map);
    }
    return map;
  };

  const rows = [];
  for (const e of employees) {
    const holidays = await holidaysFor(e.locationId);
    const perDay = shifts.get(String(e._id))!;
    rows.push({
      employee: { _id: e._id, employeeId: e.employeeId, firstName: e.firstName, lastName: e.lastName, profilePhoto: e.profilePhoto, department: e.departmentId },
      days: days.map((date) => {
        const s = perDay.get(date)!;
        const holiday = holidays.get(date);
        const dayKind = holiday && !holiday.optional ? 'HOLIDAY' : cfg.workingDays.includes(weekdayOf(date)) ? 'WORKING' : 'WEEK_OFF';
        return {
          date,
          dayKind,
          holiday: holiday?.name ?? null,
          shift: { _id: s._id, name: s.name, code: s.code, startTime: s.startTime, endTime: s.endTime, color: s.color, nightShift: s.nightShift },
        };
      }),
    });
  }
  return { from: q.from, to: q.to, dates: days, employees: rows };
};
