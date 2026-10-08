import { Types, type FilterQuery } from 'mongoose';
import { CANDIDATE_STAGES, type ReportType } from '@stencil/shared';
import {
  AssetModel,
  AttendanceModel,
  CandidateModel,
  EmployeeModel,
  ExpenseModel,
  JobOpeningModel,
  LeaveRequestModel,
  PayslipModel,
  PerformanceCycleModel,
  PerformanceReviewModel,
  type Asset,
  type Employee,
  type Expense,
  type JobOpening,
  type LeaveRequest,
  type PerformanceReview,
} from '../models';
import type { RequestContext } from '../types/context';
import { addDaysKey, dateOnly, round2, timeInTz, todayKey, toDateKey } from '../utils/dates';
import { badRequest } from '../utils/errors';
import { buildWorkCalendar } from '../services/calendar.service';
import type { ReportColumn, ReportDefinition, ReportParams, ReportResult, ReportRow } from './types';

/** Hard cap on rows produced by any report (exports included). */
export const MAX_REPORT_ROWS = 50_000;

/* ------------------------------- Helpers ------------------------------ */

const name = (v: unknown): string | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as { name?: string; title?: string; firstName?: string; lastName?: string };
  if (o.firstName) return `${o.firstName} ${o.lastName ?? ''}`.trim();
  return o.name ?? o.title ?? null;
};
const code = (v: unknown): string | null => (v && typeof v === 'object' ? ((v as { employeeId?: string; code?: string }).employeeId ?? (v as { code?: string }).code ?? null) : null);
const day = (d: Date | null | undefined) => (d ? toDateKey(d) : null);
const hours = (minutes: number) => round2(minutes / 60);

const resolveRange = (ctx: RequestContext, p: ReportParams, defaultDays: number) => {
  const today = todayKey(ctx.timezone);
  const to = p.to ?? today;
  const from = p.from ?? addDaysKey(to, -defaultDays);
  if (from > to) throw badRequest('"from" must be on or before "to"', 'INVALID_RANGE');
  if (Date.parse(to) - Date.parse(from) > 3 * 366 * 86_400_000) throw badRequest('Date range cannot exceed 3 years', 'INVALID_RANGE');
  return { from, to };
};

/** Employee ids in a department (for department-filtered reports). */
const departmentEmployeeIds = async (ctx: RequestContext, departmentId?: string | null) => {
  if (!departmentId) return null;
  const rows = await EmployeeModel.find({ organizationId: ctx.organizationId, departmentId: new Types.ObjectId(departmentId) }).select('_id').lean();
  return rows.map((r) => r._id);
};

const EMP_POPULATE = {
  path: 'employeeId',
  select: 'employeeId firstName lastName departmentId',
  populate: { path: 'departmentId', select: 'name' },
};
const empDept = (emp: unknown) => name((emp as { departmentId?: unknown } | null)?.departmentId);

const countBy = <T>(items: T[], key: (t: T) => string) => {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
};

const result = (columns: ReportColumn[], rows: ReportRow[], summary: Record<string, unknown>, range?: { from: string; to: string }): ReportResult => ({
  columns,
  rows,
  summary: { totalRows: rows.length, ...summary },
  range,
});

/* ------------------------------ Employees ----------------------------- */

const employees: ReportDefinition = {
  type: 'employees',
  title: 'Employee directory',
  description: 'All employees with department, designation, location, manager and status. Filters: department, status (employment status), from/to (joining date).',
  permissions: ['report:read'],
  build: async (ctx, p) => {
    const filter: FilterQuery<Employee> = { organizationId: ctx.organizationId, deletedAt: null };
    if (p.departmentId) filter.departmentId = new Types.ObjectId(p.departmentId);
    if (p.status) filter.employmentStatus = p.status.toUpperCase();
    if (p.from || p.to) {
      filter.joiningDate = { ...(p.from ? { $gte: dateOnly(p.from) } : {}), ...(p.to ? { $lte: dateOnly(p.to) } : {}) };
    }
    const rows = await EmployeeModel.find(filter)
      .select('employeeId firstName lastName workEmail departmentId designationId locationId managerId employmentType employmentStatus joiningDate')
      .populate([
        { path: 'departmentId', select: 'name' },
        { path: 'designationId', select: 'name' },
        { path: 'locationId', select: 'name' },
        { path: 'managerId', select: 'firstName lastName' },
      ])
      .sort({ employeeId: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    return result(
      [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Work email' },
        { key: 'department', label: 'Department' },
        { key: 'designation', label: 'Designation' },
        { key: 'location', label: 'Location' },
        { key: 'manager', label: 'Manager' },
        { key: 'employmentType', label: 'Employment type' },
        { key: 'status', label: 'Status' },
        { key: 'joiningDate', label: 'Joining date', type: 'date' },
      ],
      rows.map((e) => ({
        code: e.employeeId,
        name: `${e.firstName} ${e.lastName}`,
        email: e.workEmail,
        department: name(e.departmentId),
        designation: name(e.designationId),
        location: name(e.locationId),
        manager: name(e.managerId),
        employmentType: e.employmentType,
        status: e.employmentStatus,
        joiningDate: day(e.joiningDate),
      })),
      { byStatus: countBy(rows, (e) => e.employmentStatus), byEmploymentType: countBy(rows, (e) => e.employmentType) },
    );
  },
};

/* ----------------------------- Attendance ----------------------------- */

const attendance: ReportDefinition = {
  type: 'attendance',
  title: 'Attendance summary',
  description:
    'Per-employee present / absent / late / half-day / leave / WFH days, worked hours and overtime in the date range (default: last 30 days), plus where they checked in and out: at the office, outside the office area, or without location.',
  permissions: ['report:read'],
  build: async (ctx, p) => {
    const range = resolveRange(ctx, p, 30);
    const empFilter: FilterQuery<Employee> = {
      organizationId: ctx.organizationId,
      deletedAt: null,
      joiningDate: { $lte: dateOnly(range.to) },
      $or: [{ exitDate: null }, { exitDate: { $gte: dateOnly(range.from) } }],
    };
    if (p.departmentId) empFilter.departmentId = new Types.ObjectId(p.departmentId);
    if (p.status) empFilter.employmentStatus = p.status.toUpperCase();
    const emps = await EmployeeModel.find(empFilter)
      .select('employeeId firstName lastName departmentId')
      .populate({ path: 'departmentId', select: 'name' })
      .sort({ employeeId: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    const ids = emps.map((e) => e._id);
    const [agg, leaves, calendar] = await Promise.all([
      AttendanceModel.aggregate<{
        _id: Types.ObjectId;
        present: number;
        absent: number;
        late: number;
        halfDay: number;
        wfh: number;
        minutes: number;
        overtime: number;
        atOffice: number;
        outsideOffice: number;
        noLocation: number;
        outAtOffice: number;
        outOutsideOffice: number;
        outNoLocation: number;
      }>([
        { $match: { organizationId: ctx.organizationId, employeeId: { $in: ids }, date: { $gte: dateOnly(range.from), $lte: dateOnly(range.to) } } },
        {
          $group: {
            _id: '$employeeId',
            // Clock-in location relative to the employee's office (see attendance.service resolveCapture).
            atOffice: { $sum: { $cond: [{ $eq: ['$checkInLocation.withinOffice', true] }, 1, 0] } },
            outsideOffice: { $sum: { $cond: [{ $eq: ['$checkInLocation.withinOffice', false] }, 1, 0] } },
            noLocation: {
              $sum: { $cond: [{ $and: [{ $gt: ['$checkIn', null] }, { $not: [{ $isNumber: '$checkInLocation.latitude' }] }] }, 1, 0] },
            },
            outAtOffice: { $sum: { $cond: [{ $eq: ['$checkOutLocation.withinOffice', true] }, 1, 0] } },
            outOutsideOffice: { $sum: { $cond: [{ $eq: ['$checkOutLocation.withinOffice', false] }, 1, 0] } },
            outNoLocation: {
              $sum: { $cond: [{ $and: [{ $gt: ['$checkOut', null] }, { $not: [{ $isNumber: '$checkOutLocation.latitude' }] }] }, 1, 0] },
            },
            present: { $sum: { $cond: [{ $in: ['$status', ['PRESENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME']] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
            late: { $sum: { $cond: [{ $or: [{ $eq: ['$status', 'LATE'] }, { $eq: ['$isLate', true] }] }, 1, 0] } },
            halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HALF_DAY'] }, 1, 0] } },
            wfh: { $sum: { $cond: [{ $or: [{ $eq: ['$status', 'WORK_FROM_HOME'] }, { $eq: ['$workMode', 'REMOTE'] }] }, 1, 0] } },
            minutes: { $sum: '$workingMinutes' },
            overtime: { $sum: '$overtimeMinutes' },
          },
        },
      ]),
      LeaveRequestModel.find({
        organizationId: ctx.organizationId,
        employeeId: { $in: ids },
        status: 'APPROVED',
        startDate: { $lte: dateOnly(range.to) },
        endDate: { $gte: dateOnly(range.from) },
      })
        .select('employeeId startDate endDate halfDay leaveTypeId')
        .populate({ path: 'leaveTypeId', select: 'isWorkFromHome' })
        .lean(),
      buildWorkCalendar(ctx.organizationId, range.from, range.to),
    ]);
    const byEmp = new Map(agg.map((a) => [String(a._id), a]));
    const leaveDays = new Map<string, number>();
    for (const l of leaves) {
      if ((l.leaveTypeId as unknown as { isWorkFromHome?: boolean } | null)?.isWorkFromHome) continue;
      const from = toDateKey(l.startDate) < range.from ? range.from : toDateKey(l.startDate);
      const to = toDateKey(l.endDate) > range.to ? range.to : toDateKey(l.endDate);
      const days = l.halfDay ? 0.5 : calendar.workingDates(from, to).length;
      leaveDays.set(String(l.employeeId), (leaveDays.get(String(l.employeeId)) ?? 0) + days);
    }
    const workingDays = calendar.workingDates(range.from, range.to).length;
    const rows = emps.map((e) => {
      const a = byEmp.get(String(e._id));
      return {
        code: e.employeeId,
        name: `${e.firstName} ${e.lastName}`,
        department: name(e.departmentId),
        present: a?.present ?? 0,
        absent: a?.absent ?? 0,
        late: a?.late ?? 0,
        halfDay: a?.halfDay ?? 0,
        leave: leaveDays.get(String(e._id)) ?? 0,
        wfh: a?.wfh ?? 0,
        hours: hours(a?.minutes ?? 0),
        overtimeHours: hours(a?.overtime ?? 0),
        atOffice: a?.atOffice ?? 0,
        outsideOffice: a?.outsideOffice ?? 0,
        noLocation: a?.noLocation ?? 0,
        outAtOffice: a?.outAtOffice ?? 0,
        outOutsideOffice: a?.outOutsideOffice ?? 0,
        outNoLocation: a?.outNoLocation ?? 0,
      };
    });
    const sum = (k: keyof (typeof rows)[number]) => round2(rows.reduce((acc, r) => acc + Number(r[k] ?? 0), 0));
    return result(
      [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'present', label: 'Present', type: 'number' },
        { key: 'absent', label: 'Absent', type: 'number' },
        { key: 'late', label: 'Late', type: 'number' },
        { key: 'halfDay', label: 'Half day', type: 'number' },
        { key: 'leave', label: 'Leave', type: 'number' },
        { key: 'wfh', label: 'WFH', type: 'number' },
        { key: 'hours', label: 'Hours worked', type: 'number' },
        { key: 'overtimeHours', label: 'Overtime hours', type: 'number' },
        { key: 'atOffice', label: 'Check-ins at office', type: 'number' },
        { key: 'outsideOffice', label: 'Check-ins outside office', type: 'number' },
        { key: 'noLocation', label: 'Check-ins without location', type: 'number' },
        { key: 'outAtOffice', label: 'Check-outs at office', type: 'number' },
        { key: 'outOutsideOffice', label: 'Check-outs outside office', type: 'number' },
        { key: 'outNoLocation', label: 'Check-outs without location', type: 'number' },
      ],
      rows,
      {
        workingDays,
        totals: {
          present: sum('present'),
          absent: sum('absent'),
          late: sum('late'),
          halfDay: sum('halfDay'),
          leave: sum('leave'),
          wfh: sum('wfh'),
          hours: sum('hours'),
          overtimeHours: sum('overtimeHours'),
          atOffice: sum('atOffice'),
          outsideOffice: sum('outsideOffice'),
          noLocation: sum('noLocation'),
          outAtOffice: sum('outAtOffice'),
          outOutsideOffice: sum('outOutsideOffice'),
          outNoLocation: sum('outNoLocation'),
        },
      },
      range,
    );
  },
};

/* ------------------------ Attendance log (location) -------------------- */

interface GeoCapture {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  officeName?: string | null;
  distanceMeters?: number | null;
  withinOffice?: boolean | null;
}

const hasPoint = (g?: GeoCapture | null): g is GeoCapture & { latitude: number; longitude: number } =>
  typeof g?.latitude === 'number' && typeof g?.longitude === 'number';

/** "At office" / "Outside office" / "No office area set" / "No location". */
const placeLabel = (g?: GeoCapture | null) => {
  if (!hasPoint(g)) return 'No location';
  if (g.withinOffice === true) return 'At office';
  if (g.withinOffice === false) return 'Outside office';
  return typeof g.distanceMeters === 'number' ? 'Office area not set' : 'No office coordinates';
};
const coords = (g?: GeoCapture | null) => (hasPoint(g) ? `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}` : null);
const mapUrl = (g?: GeoCapture | null) => (hasPoint(g) ? `https://www.google.com/maps?q=${g.latitude},${g.longitude}` : null);

const attendanceLog: ReportDefinition = {
  type: 'attendance_log',
  title: 'Attendance log (with location)',
  description:
    'One row per employee per day in the range (default: last 7 days): check-in / check-out times and where they happened — office, distance from it, at office or outside, coordinates and a map link. Status filters the attendance status.',
  permissions: ['report:read', 'attendance:read'],
  build: async (ctx, p) => {
    const range = resolveRange(ctx, p, 7);
    const filter: Record<string, unknown> = {
      organizationId: ctx.organizationId,
      date: { $gte: dateOnly(range.from), $lte: dateOnly(range.to) },
    };
    if (p.status) filter.status = p.status.toUpperCase();
    const deptIds = await departmentEmployeeIds(ctx, p.departmentId);
    if (deptIds) filter.employeeId = { $in: deptIds };
    const rows = await AttendanceModel.find(filter)
      .select('employeeId date status workMode checkIn checkOut workingMinutes checkInLocation checkOutLocation')
      .populate(EMP_POPULATE)
      .sort({ date: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    rows.sort((a, b) => a.date.getTime() - b.date.getTime() || String(code(a.employeeId)).localeCompare(String(code(b.employeeId))));
    const time = (d?: Date | null) => (d ? timeInTz(d, ctx.timezone) : null);
    const out = rows.map((r) => {
      const ci = r.checkInLocation as GeoCapture | undefined;
      const co = r.checkOutLocation as GeoCapture | undefined;
      return {
        date: day(r.date),
        code: code(r.employeeId),
        name: name(r.employeeId),
        department: empDept(r.employeeId),
        status: r.status,
        workMode: r.workMode,
        checkIn: time(r.checkIn),
        checkInPlace: r.checkIn ? placeLabel(ci) : null,
        checkInOffice: ci?.officeName ?? null,
        checkInDistance: typeof ci?.distanceMeters === 'number' ? ci.distanceMeters : null,
        checkInAccuracy: typeof ci?.accuracy === 'number' ? Math.round(ci.accuracy) : null,
        checkInCoordinates: coords(ci),
        checkInMap: mapUrl(ci),
        checkOut: time(r.checkOut),
        checkOutPlace: r.checkOut ? placeLabel(co) : null,
        checkOutDistance: typeof co?.distanceMeters === 'number' ? co.distanceMeters : null,
        checkOutCoordinates: coords(co),
        checkOutMap: mapUrl(co),
        hours: hours(r.workingMinutes ?? 0),
      };
    });
    const clockedIn = out.filter((r) => r.checkIn);
    return result(
      [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' },
        { key: 'workMode', label: 'Work mode' },
        { key: 'checkIn', label: 'Check in' },
        { key: 'checkInPlace', label: 'Check-in place' },
        { key: 'checkInOffice', label: 'Office' },
        { key: 'checkInDistance', label: 'Distance from office (m)', type: 'number' },
        { key: 'checkInAccuracy', label: 'GPS accuracy (m)', type: 'number' },
        { key: 'checkInCoordinates', label: 'Check-in coordinates' },
        { key: 'checkInMap', label: 'Check-in map' },
        { key: 'checkOut', label: 'Check out' },
        { key: 'checkOutPlace', label: 'Check-out place' },
        { key: 'checkOutDistance', label: 'Check-out distance (m)', type: 'number' },
        { key: 'checkOutCoordinates', label: 'Check-out coordinates' },
        { key: 'checkOutMap', label: 'Check-out map' },
        { key: 'hours', label: 'Hours worked', type: 'number' },
      ],
      out,
      {
        days: out.length,
        clockIns: clockedIn.length,
        byClockInPlace: countBy(clockedIn, (r) => r.checkInPlace ?? 'No location'),
      },
      range,
    );
  },
};

/* -------------------------------- Leave ------------------------------- */

const leave: ReportDefinition = {
  type: 'leave',
  title: 'Leave requests',
  description: 'Leave requests overlapping the date range (default: last 90 days) with type, days and status, plus totals by type.',
  permissions: ['report:read'],
  build: async (ctx, p) => {
    const range = resolveRange(ctx, p, 90);
    const filter: FilterQuery<LeaveRequest> = {
      organizationId: ctx.organizationId,
      startDate: { $lte: dateOnly(range.to) },
      endDate: { $gte: dateOnly(range.from) },
    };
    if (p.status) filter.status = p.status.toUpperCase();
    const deptIds = await departmentEmployeeIds(ctx, p.departmentId);
    if (deptIds) filter.employeeId = { $in: deptIds };
    const rows = await LeaveRequestModel.find(filter)
      .populate(EMP_POPULATE)
      .populate({ path: 'leaveTypeId', select: 'name code' })
      .sort({ startDate: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    const approvedByType: Record<string, number> = {};
    const daysByStatus: Record<string, number> = {};
    for (const r of rows) {
      daysByStatus[r.status] = round2((daysByStatus[r.status] ?? 0) + r.days);
      if (r.status === 'APPROVED') {
        const t = name(r.leaveTypeId) ?? 'Unknown';
        approvedByType[t] = round2((approvedByType[t] ?? 0) + r.days);
      }
    }
    return result(
      [
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'leaveType', label: 'Leave type' },
        { key: 'from', label: 'From', type: 'date' },
        { key: 'to', label: 'To', type: 'date' },
        { key: 'days', label: 'Days', type: 'number' },
        { key: 'status', label: 'Status' },
        { key: 'appliedOn', label: 'Applied on', type: 'date' },
      ],
      rows.map((r) => ({
        code: code(r.employeeId),
        name: name(r.employeeId),
        department: empDept(r.employeeId),
        leaveType: name(r.leaveTypeId),
        from: day(r.startDate),
        to: day(r.endDate),
        days: r.days,
        status: r.status,
        appliedOn: day(r.submittedAt ?? (r as { createdAt?: Date }).createdAt),
      })),
      { byStatus: countBy(rows, (r) => r.status), daysByStatus, approvedDaysByType: approvedByType },
      range,
    );
  },
};

/* ------------------------------- Payroll ------------------------------ */

const payroll: ReportDefinition = {
  type: 'payroll',
  title: 'Payroll register',
  description: 'Payslips for pay periods within the range (default: last 12 months): gross, deductions and net per employee. Bank details are never included.',
  permissions: ['report:read', 'payroll:read'],
  build: async (ctx, p) => {
    const range = resolveRange(ctx, p, 365);
    const fromP = Number(range.from.slice(0, 4)) * 100 + Number(range.from.slice(5, 7));
    const toP = Number(range.to.slice(0, 4)) * 100 + Number(range.to.slice(5, 7));
    const period = { $add: [{ $multiply: ['$year', 100] }, '$month'] };
    const filter: Record<string, unknown> = {
      organizationId: ctx.organizationId,
      $expr: { $and: [{ $gte: [period, fromP] }, { $lte: [period, toP] }] },
      status: p.status ? p.status.toUpperCase() : { $ne: 'CANCELLED' },
    };
    const deptIds = await departmentEmployeeIds(ctx, p.departmentId);
    if (deptIds) filter.employeeId = { $in: deptIds };
    const rows = await PayslipModel.find(filter)
      .select('month year currency status employeeSnapshot.employeeId employeeSnapshot.name employeeSnapshot.department employeeSnapshot.designation payableDays grossEarnings totalDeductions netPay')
      .sort({ year: 1, month: 1, 'employeeSnapshot.employeeId': 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    const totals = rows.reduce(
      (a, r) => ({ gross: a.gross + r.grossEarnings, deductions: a.deductions + r.totalDeductions, net: a.net + r.netPay }),
      { gross: 0, deductions: 0, net: 0 },
    );
    return result(
      [
        { key: 'period', label: 'Period' },
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'designation', label: 'Designation' },
        { key: 'payableDays', label: 'Payable days', type: 'number' },
        { key: 'gross', label: 'Gross', type: 'number' },
        { key: 'deductions', label: 'Deductions', type: 'number' },
        { key: 'net', label: 'Net pay', type: 'number' },
        { key: 'currency', label: 'Currency' },
        { key: 'status', label: 'Status' },
      ],
      rows.map((r) => ({
        period: `${r.year}-${String(r.month).padStart(2, '0')}`,
        code: r.employeeSnapshot?.employeeId ?? null,
        name: r.employeeSnapshot?.name ?? null,
        department: r.employeeSnapshot?.department ?? null,
        designation: r.employeeSnapshot?.designation ?? null,
        payableDays: r.payableDays ?? null,
        gross: round2(r.grossEarnings),
        deductions: round2(r.totalDeductions),
        net: round2(r.netPay),
        currency: r.currency,
        status: r.status,
      })),
      { totals: { gross: round2(totals.gross), deductions: round2(totals.deductions), net: round2(totals.net) }, payslips: rows.length },
      range,
    );
  },
};

/* ------------------------------ Expenses ------------------------------ */

const expenses: ReportDefinition = {
  type: 'expenses',
  title: 'Expense claims',
  description: 'Expense claims dated within the range (default: last 90 days) with totals by status and category.',
  permissions: ['report:read', 'expense:read'],
  build: async (ctx, p) => {
    const range = resolveRange(ctx, p, 90);
    const filter: FilterQuery<Expense> = { organizationId: ctx.organizationId, date: { $gte: dateOnly(range.from), $lte: dateOnly(range.to) } };
    if (p.status) filter.status = p.status.toUpperCase();
    const deptIds = await departmentEmployeeIds(ctx, p.departmentId);
    if (deptIds) filter.employeeId = { $in: deptIds };
    const rows = await ExpenseModel.find(filter).populate(EMP_POPULATE).sort({ date: 1 }).limit(MAX_REPORT_ROWS).lean();
    const byStatus: Record<string, { count: number; amount: number }> = {};
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      const s = (byStatus[r.status] ??= { count: 0, amount: 0 });
      s.count++;
      s.amount = round2(s.amount + r.amount);
      byCategory[r.category] = round2((byCategory[r.category] ?? 0) + r.amount);
    }
    return result(
      [
        { key: 'number', label: 'Expense #' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'merchant', label: 'Merchant' },
        { key: 'amount', label: 'Amount', type: 'number' },
        { key: 'currency', label: 'Currency' },
        { key: 'status', label: 'Status' },
      ],
      rows.map((r) => ({
        number: r.expenseNumber,
        date: day(r.date),
        code: code(r.employeeId),
        name: name(r.employeeId),
        department: empDept(r.employeeId),
        category: r.category,
        description: r.description,
        merchant: r.merchant ?? null,
        amount: round2(r.amount),
        currency: r.currency,
        status: r.status,
      })),
      { byStatus, byCategory, totalAmount: round2(rows.reduce((a, r) => a + r.amount, 0)) },
      range,
    );
  },
};

/* ----------------------------- Recruitment ---------------------------- */

const recruitment: ReportDefinition = {
  type: 'recruitment',
  title: 'Recruitment pipeline',
  description: 'Candidates per job and stage, plus hires. With from/to, counts candidates who applied (and hires made) in the range. Status filters job status.',
  permissions: ['report:read', 'recruitment:read'],
  build: async (ctx, p) => {
    const jobFilter: FilterQuery<JobOpening> = { organizationId: ctx.organizationId, deletedAt: null };
    if (p.departmentId) jobFilter.departmentId = new Types.ObjectId(p.departmentId);
    if (p.status) jobFilter.status = p.status.toUpperCase();
    const jobs = await JobOpeningModel.find(jobFilter)
      .select('code title departmentId status openings filled')
      .populate({ path: 'departmentId', select: 'name' })
      .sort({ code: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    const range = p.from || p.to ? resolveRange(ctx, p, 365) : undefined;
    const created = range ? { createdAt: { $gte: dateOnly(range.from), $lt: dateOnly(addDaysKey(range.to, 1)) } } : {};
    const [stageAgg, hireAgg] = await Promise.all([
      CandidateModel.aggregate<{ _id: { job: Types.ObjectId; stage: string }; n: number }>([
        { $match: { organizationId: ctx.organizationId, deletedAt: null, jobId: { $in: jobs.map((j) => j._id) }, ...created } },
        { $group: { _id: { job: '$jobId', stage: '$stage' }, n: { $sum: 1 } } },
      ]),
      CandidateModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            jobId: { $in: jobs.map((j) => j._id) },
            stage: 'HIRED',
            ...(range ? { hiredAt: { $gte: dateOnly(range.from), $lt: dateOnly(addDaysKey(range.to, 1)) } } : {}),
          },
        },
        { $group: { _id: '$jobId', n: { $sum: 1 } } },
      ]),
    ]);
    const stageCounts = new Map(stageAgg.map((s) => [`${s._id.job}:${s._id.stage}`, s.n]));
    const hires = new Map(hireAgg.map((h) => [String(h._id), h.n]));
    const stageTotals: Record<string, number> = {};
    const rows = jobs.map((j) => {
      const row: ReportRow = {
        code: j.code,
        title: j.title,
        department: name(j.departmentId),
        status: j.status,
        openings: j.openings,
        filled: j.filled,
      };
      let total = 0;
      for (const stage of CANDIDATE_STAGES) {
        const n = stageCounts.get(`${j._id}:${stage}`) ?? 0;
        row[stage] = n;
        total += n;
        stageTotals[stage] = (stageTotals[stage] ?? 0) + n;
      }
      row.totalCandidates = total;
      row.hires = hires.get(String(j._id)) ?? 0;
      return row;
    });
    return result(
      [
        { key: 'code', label: 'Job code' },
        { key: 'title', label: 'Job title' },
        { key: 'department', label: 'Department' },
        { key: 'status', label: 'Status' },
        { key: 'openings', label: 'Openings', type: 'number' },
        { key: 'filled', label: 'Filled', type: 'number' },
        ...CANDIDATE_STAGES.map((s) => ({ key: s, label: s.charAt(0) + s.slice(1).toLowerCase(), type: 'number' as const })),
        { key: 'totalCandidates', label: 'Candidates', type: 'number' },
        { key: 'hires', label: 'Hires', type: 'number' },
      ],
      rows,
      { jobs: rows.length, byStage: stageTotals, hires: [...hires.values()].reduce((a, b) => a + b, 0) },
      range,
    );
  },
};

/* ----------------------------- Performance ---------------------------- */

const performance: ReportDefinition = {
  type: 'performance',
  title: 'Performance reviews',
  description: 'Reviews with self, manager and final ratings per cycle. from/to selects cycles overlapping the range; status filters review status.',
  permissions: ['report:read'],
  build: async (ctx, p) => {
    const cycleFilter: Record<string, unknown> = { organizationId: ctx.organizationId, deletedAt: null };
    if (p.from) cycleFilter.endDate = { $gte: dateOnly(p.from) };
    if (p.to) cycleFilter.startDate = { $lte: dateOnly(p.to) };
    const cycles = await PerformanceCycleModel.find(cycleFilter).select('_id').lean();
    const filter: FilterQuery<PerformanceReview> = { organizationId: ctx.organizationId, cycleId: { $in: cycles.map((c) => c._id) } };
    if (p.status) filter.status = p.status.toUpperCase();
    const deptIds = await departmentEmployeeIds(ctx, p.departmentId);
    if (deptIds) filter.employeeId = { $in: deptIds };
    const rows = await PerformanceReviewModel.find(filter)
      .populate(EMP_POPULATE)
      .populate({ path: 'managerId', select: 'firstName lastName' })
      .populate({ path: 'cycleId', select: 'name' })
      .sort({ cycleId: 1, employeeId: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    const rated = rows.filter((r) => typeof r.finalRating === 'number');
    return result(
      [
        { key: 'cycle', label: 'Cycle' },
        { key: 'code', label: 'Employee ID' },
        { key: 'name', label: 'Name' },
        { key: 'department', label: 'Department' },
        { key: 'manager', label: 'Manager' },
        { key: 'status', label: 'Status' },
        { key: 'selfRating', label: 'Self rating', type: 'number' },
        { key: 'managerRating', label: 'Manager rating', type: 'number' },
        { key: 'goalScore', label: 'Goal score', type: 'number' },
        { key: 'finalRating', label: 'Final rating', type: 'number' },
        { key: 'finalRatingLabel', label: 'Rating label' },
      ],
      rows.map((r) => ({
        cycle: name(r.cycleId),
        code: code(r.employeeId),
        name: name(r.employeeId),
        department: empDept(r.employeeId),
        manager: name(r.managerId),
        status: r.status,
        selfRating: r.selfReview?.overallRating ?? null,
        managerRating: r.managerReview?.overallRating ?? null,
        goalScore: r.goalScore ?? null,
        finalRating: r.finalRating ?? null,
        finalRatingLabel: r.finalRatingLabel ?? null,
      })),
      {
        byStatus: countBy(rows, (r) => r.status),
        averageFinalRating: rated.length ? round2(rated.reduce((a, r) => a + (r.finalRating ?? 0), 0) / rated.length) : null,
        cycles: cycles.length,
      },
    );
  },
};

/* ------------------------------- Assets ------------------------------- */

const assets: ReportDefinition = {
  type: 'assets',
  title: 'Asset inventory',
  description: 'All assets with status, condition, assignee and purchase value. Department filters by the assignee\'s department.',
  permissions: ['report:read'],
  build: async (ctx, p) => {
    const filter: FilterQuery<Asset> = { organizationId: ctx.organizationId, deletedAt: null };
    if (p.status) filter.status = p.status.toUpperCase();
    const deptIds = await departmentEmployeeIds(ctx, p.departmentId);
    if (deptIds) filter.currentEmployeeId = { $in: deptIds };
    const rows = await AssetModel.find(filter)
      .select('assetTag name category brand model serialNumber status condition currentEmployeeId locationId purchaseDate purchaseCost warrantyExpiry')
      .populate([
        { path: 'currentEmployeeId', select: 'employeeId firstName lastName' },
        { path: 'locationId', select: 'name' },
      ])
      .sort({ assetTag: 1 })
      .limit(MAX_REPORT_ROWS)
      .lean();
    const valueByStatus: Record<string, number> = {};
    for (const r of rows) valueByStatus[r.status] = round2((valueByStatus[r.status] ?? 0) + (r.purchaseCost ?? 0));
    return result(
      [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'name', label: 'Name' },
        { key: 'category', label: 'Category' },
        { key: 'brand', label: 'Brand' },
        { key: 'model', label: 'Model' },
        { key: 'serialNumber', label: 'Serial number' },
        { key: 'status', label: 'Status' },
        { key: 'condition', label: 'Condition' },
        { key: 'assignee', label: 'Assigned to' },
        { key: 'location', label: 'Location' },
        { key: 'purchaseDate', label: 'Purchase date', type: 'date' },
        { key: 'value', label: 'Purchase cost', type: 'number' },
        { key: 'warrantyExpiry', label: 'Warranty expiry', type: 'date' },
      ],
      rows.map((r) => ({
        assetTag: r.assetTag,
        name: r.name,
        category: r.category,
        brand: r.brand ?? null,
        model: r.model ?? null,
        serialNumber: r.serialNumber ?? null,
        status: r.status,
        condition: r.condition,
        assignee: r.currentEmployeeId ? `${name(r.currentEmployeeId)} (${code(r.currentEmployeeId)})` : null,
        location: name(r.locationId),
        purchaseDate: day(r.purchaseDate),
        value: r.purchaseCost ?? null,
        warrantyExpiry: day(r.warrantyExpiry),
      })),
      {
        byStatus: countBy(rows, (r) => r.status),
        byCategory: countBy(rows, (r) => r.category),
        totalValue: round2(rows.reduce((a, r) => a + (r.purchaseCost ?? 0), 0)),
        valueByStatus,
      },
    );
  },
};

/**
 * Report catalog. Permission model: every report requires `report:read`;
 * payroll additionally requires `payroll:read`, recruitment `recruitment:read`
 * and expenses `expense:read`.
 */
export const REPORTS: Record<ReportType, ReportDefinition> = {
  employees,
  attendance,
  attendance_log: attendanceLog,
  leave,
  payroll,
  expenses,
  recruitment,
  performance,
  assets,
};
