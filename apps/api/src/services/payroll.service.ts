import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import ExcelJS from 'exceljs';
import { PAYROLL_WORKFLOW, type PaginationQuery, type PayrollStatus } from '@stencil/shared';
import {
  AttendanceModel,
  EmployeeModel,
  LeaveRequestModel,
  LeaveTypeModel,
  LoanModel,
  OrganizationModel,
  PayrollAdjustmentModel,
  PayrollModel,
  PayslipModel,
  SalaryComponentModel,
  SalaryStructureModel,
  type SalaryComponent,
} from '../models';
import { computeDays } from '../payroll/core/days';
import { evaluateSalary, overtimeAmount, round2 } from '../payroll/core/engine';
import { applyPayrollRules } from '../payroll/rules';
import { periodLabel } from '../pdf/payslip.pdf';
import type { RequestContext } from '../types/context';
import { dateOnly, eachDateKey, monthRange, toDateKey, todayKey } from '../utils/dates';
import { badRequest, conflict, forbidden, invalidTransition, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { audit } from './audit.service';
import { buildWorkCalendar, type WorkCalendar } from './calendar.service';
import { userIdsWithPermission } from './notification.service';
import { notifyPayslipsPublished } from './payslip.service';
import { assertIdsInOrg } from './refs.service';
import { engineInputFromStructure } from './salary.service';

type Id = Types.ObjectId;

const RUN_POPULATE = [
  { path: 'createdBy', select: 'firstName lastName' },
  { path: 'processedBy', select: 'firstName lastName' },
  { path: 'approvedBy', select: 'firstName lastName' },
  { path: 'paidBy', select: 'firstName lastName' },
];

const periodKeyOf = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

const loadRun = async (ctx: RequestContext, id: string | Id, session?: ClientSession) => {
  const run = await PayrollModel.findOne({ _id: id, organizationId: ctx.organizationId }).session(session ?? null);
  if (!run) throw notFound('Payroll');
  return run;
};

const assertTransition = (from: string, to: PayrollStatus) => {
  if (!PAYROLL_WORKFLOW.can(from as PayrollStatus, to)) throw invalidTransition('Payroll', from, to);
};

const historyEntry = (ctx: RequestContext, status: PayrollStatus) => ({ status, at: new Date(), by: ctx.userId });

const runLabel = (run: { month: number; year: number; isOffCycle?: boolean | null }) =>
  `${periodLabel(run.month, run.year)}${run.isOffCycle ? ' (off-cycle)' : ''}`;

/* -------------------------------- Queries -------------------------------- */

export const listPayrolls = async (ctx: RequestContext, q: PaginationQuery & { year?: number; status?: string }) =>
  paginate(PayrollModel, {
    filter: {
      organizationId: ctx.organizationId,
      ...(q.year ? { year: q.year } : {}),
      ...(q.status ? { status: q.status } : {}),
    },
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['year', 'month', 'status', 'createdAt', 'totalNet'], { year: -1, month: -1, createdAt: -1 }),
    populate: RUN_POPULATE,
  });

export const getPayroll = async (ctx: RequestContext, id: string) => {
  const run = await PayrollModel.findOne({ _id: id, organizationId: ctx.organizationId }).populate(RUN_POPULATE).lean();
  if (!run) throw notFound('Payroll');
  const payslips = await PayslipModel.find({ organizationId: ctx.organizationId, payrollId: run._id })
    .select('employeeId employeeSnapshot.employeeId employeeSnapshot.name employeeSnapshot.department employeeSnapshot.designation status payableDays lopDays grossEarnings totalDeductions netPay')
    .sort({ 'employeeSnapshot.employeeId': 1 })
    .limit(5000)
    .lean();
  return { ...run, payslips };
};

export const listRunPayslips = async (ctx: RequestContext, id: string, q: PaginationQuery) => {
  const run = await PayrollModel.exists({ _id: id, organizationId: ctx.organizationId });
  if (!run) throw notFound('Payroll');
  return paginate(PayslipModel, {
    filter: {
      organizationId: ctx.organizationId,
      payrollId: run._id,
      ...searchFilter(q.search, ['employeeSnapshot.name', 'employeeSnapshot.employeeId', 'employeeSnapshot.department']),
    },
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['netPay', 'grossEarnings', 'employeeSnapshot.name', 'employeeSnapshot.employeeId'], { 'employeeSnapshot.employeeId': 1 }),
  });
};

/** Per-month totals for a year (non-cancelled runs, regular + off-cycle). */
export const payrollSummary = async (ctx: RequestContext, q: { year?: number }) => {
  const year = q.year ?? Number(todayKey(ctx.timezone).slice(0, 4));
  const rows = await PayrollModel.aggregate<{
    _id: number;
    runs: number;
    employeeCount: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    totalEmployerContributions: number;
    statuses: string[];
  }>([
    // Amounts in different currencies can't be summed; the monthly series uses the org currency only.
    { $match: { organizationId: ctx.organizationId, year, status: { $ne: 'CANCELLED' }, currency: ctx.currency } },
    {
      $group: {
        _id: '$month',
        runs: { $sum: 1 },
        employeeCount: { $sum: '$employeeCount' },
        totalGross: { $sum: '$totalGross' },
        totalDeductions: { $sum: '$totalDeductions' },
        totalNet: { $sum: '$totalNet' },
        totalEmployerContributions: { $sum: '$totalEmployerContributions' },
        statuses: { $addToSet: '$status' },
      },
    },
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, r]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const r = byMonth.get(i + 1);
    return {
      month: i + 1,
      runs: r?.runs ?? 0,
      employeeCount: r?.employeeCount ?? 0,
      totalGross: round2(r?.totalGross ?? 0),
      totalDeductions: round2(r?.totalDeductions ?? 0),
      totalNet: round2(r?.totalNet ?? 0),
      totalEmployerContributions: round2(r?.totalEmployerContributions ?? 0),
      totalCost: round2((r?.totalGross ?? 0) + (r?.totalEmployerContributions ?? 0)),
      statuses: r?.statuses ?? [],
    };
  });
  const total = (k: 'totalGross' | 'totalDeductions' | 'totalNet' | 'totalEmployerContributions' | 'totalCost') => round2(months.reduce((s, m) => s + m[k], 0));
  return {
    year,
    currency: ctx.currency,
    months,
    totals: {
      totalGross: total('totalGross'),
      totalDeductions: total('totalDeductions'),
      totalNet: total('totalNet'),
      totalEmployerContributions: total('totalEmployerContributions'),
      totalCost: total('totalCost'),
    },
    // Runs processed in another currency (e.g. after a currency change), totalled per currency.
    otherCurrencies: await PayrollModel.aggregate<{ currency: string; runs: number; totalGross: number; totalNet: number }>([
      { $match: { organizationId: ctx.organizationId, year, status: { $ne: 'CANCELLED' }, currency: { $ne: ctx.currency } } },
      { $group: { _id: '$currency', runs: { $sum: 1 }, totalGross: { $sum: '$totalGross' }, totalNet: { $sum: '$totalNet' } } },
      { $project: { _id: 0, currency: '$_id', runs: 1, totalGross: { $round: ['$totalGross', 2] }, totalNet: { $round: ['$totalNet', 2] } } },
    ]),
  };
};

/* -------------------------------- Create --------------------------------- */

export const createPayroll = async (ctx: RequestContext, input: { month: number; year: number; employeeIds?: string[]; notes?: string }) => {
  const { start, end } = monthRange(input.year, input.month);
  const offCycle = !!input.employeeIds?.length;
  if (offCycle) await assertIdsInOrg(ctx.organizationId, EmployeeModel as never, input.employeeIds!, 'employees');
  const periodKey = offCycle ? null : periodKeyOf(input.year, input.month);
  if (periodKey && (await PayrollModel.exists({ organizationId: ctx.organizationId, periodKey }))) {
    throw conflict(`A payroll run for ${periodLabel(input.month, input.year)} already exists`, 'PAYROLL_EXISTS');
  }
  let run;
  try {
    run = await PayrollModel.create({
      organizationId: ctx.organizationId,
      month: input.month,
      year: input.year,
      periodStart: dateOnly(start),
      periodEnd: dateOnly(end),
      periodKey,
      status: 'DRAFT',
      currency: ctx.currency,
      employeeIds: offCycle ? [...new Set(input.employeeIds)].map((id) => new Types.ObjectId(id)) : [],
      isOffCycle: offCycle,
      notes: input.notes,
      createdBy: ctx.userId,
      statusHistory: [historyEntry(ctx, 'DRAFT')],
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw conflict(`A payroll run for ${periodLabel(input.month, input.year)} already exists`, 'PAYROLL_EXISTS');
    }
    throw err;
  }
  await audit(ctx, {
    action: 'PAYROLL_CREATED',
    module: 'payroll',
    recordId: run._id,
    recordLabel: runLabel(run),
    newValues: { month: run.month, year: run.year, isOffCycle: run.isOffCycle, employeeCount: run.employeeIds.length || undefined },
  });
  return run.toJSON();
};

/* ------------------------------- Processing ------------------------------ */

type ComponentLean = SalaryComponent & { _id: Id };

interface ComputedRun {
  payslips: Record<string, unknown>[];
  adjustmentIds: Id[];
  warnings: string[];
  totals: { totalGross: number; totalDeductions: number; totalNet: number; totalEmployerContributions: number; employeeCount: number };
}

/**
 * Computes every payslip of a run (read-only). Rules:
 *  - Employees: the run's `employeeIds` (off-cycle), otherwise everyone not
 *    archived who joined on/before period end and has not exited before period start.
 *  - Structure: the version in force on min(periodEnd, exitDate); none → warning, skipped.
 *  - Days: see payroll/core/days.ts (LOP = unpaid leave + unexcused absence;
 *    days outside employment are unpaid; basis per settings.payroll.workingDaysBasis).
 *  - Overtime = (full-month structural gross / (workingDays × shift hours [default 8]))
 *    × overtime hours × settings.payroll.overtimeMultiplier, paid as earning OVERTIME.
 *  - Statutory deductions are evaluated on prorated gross (incl. overtime);
 *    one-off adjustments are added after (not part of the statutory base).
 *  - Loan/advance recovery: min(installment, outstanding, remaining net pay) for
 *    active loans starting on/before the period, once per period.
 */
const computeRun = async (ctx: RequestContext, run: { _id: Id; month: number; year: number; periodStart: Date; periodEnd: Date; employeeIds: Id[]; currency: string }): Promise<ComputedRun> => {
  const org = await OrganizationModel.findById(ctx.organizationId).select('settings.payroll').lean();
  const settings = org?.settings?.payroll;
  const basis = (settings?.workingDaysBasis ?? 'CALENDAR') as 'CALENDAR' | 'WORKING';
  const multiplier = settings?.overtimeMultiplier ?? 1.5;
  const countryRules = settings?.countryRules ?? 'GENERIC';
  const ps = toDateKey(run.periodStart);
  const pe = toDateKey(run.periodEnd);
  const dates = eachDateKey(ps, pe);

  const employeeFilter: FilterQuery<unknown> = run.employeeIds.length
    ? { organizationId: ctx.organizationId, _id: { $in: run.employeeIds } }
    : {
        organizationId: ctx.organizationId,
        deletedAt: null,
        employmentStatus: { $ne: 'ARCHIVED' },
        joiningDate: { $lte: run.periodEnd },
        $or: [{ exitDate: null }, { exitDate: { $gte: run.periodStart } }],
      };
  const employees = await EmployeeModel.find(employeeFilter)
    .select('+bank employeeId firstName lastName workEmail departmentId designationId locationId shiftId joiningDate exitDate')
    .populate([
      { path: 'departmentId', select: 'name' },
      { path: 'designationId', select: 'name' },
      { path: 'locationId', select: 'name' },
      { path: 'shiftId', select: 'workingHours' },
    ])
    .sort({ employeeId: 1 })
    .lean();
  const empIds = employees.map((e) => e._id);

  const [structures, leaves, leaveTypes, attendance, adjustments, loans, masters] = await Promise.all([
    SalaryStructureModel.find({ organizationId: ctx.organizationId, employeeId: { $in: empIds }, effectiveFrom: { $lte: run.periodEnd } })
      .sort({ effectiveFrom: -1 })
      .lean(),
    LeaveRequestModel.find({
      organizationId: ctx.organizationId,
      employeeId: { $in: empIds },
      status: 'APPROVED',
      startDate: { $lte: run.periodEnd },
      endDate: { $gte: run.periodStart },
    }).lean(),
    LeaveTypeModel.find({ organizationId: ctx.organizationId }).select('paid').lean(),
    AttendanceModel.find({ organizationId: ctx.organizationId, employeeId: { $in: empIds }, date: { $gte: run.periodStart, $lte: run.periodEnd } })
      .select('employeeId date status overtimeMinutes')
      .lean(),
    PayrollAdjustmentModel.find({
      organizationId: ctx.organizationId,
      employeeId: { $in: empIds },
      month: run.month,
      year: run.year,
      $or: [{ payrollId: null }, { payrollId: run._id }],
    })
      .sort({ createdAt: 1 })
      .lean(),
    LoanModel.find({
      organizationId: ctx.organizationId,
      employeeId: { $in: empIds },
      status: 'ACTIVE',
      outstanding: { $gt: 0 },
      $or: [{ startYear: { $lt: run.year } }, { startYear: run.year, startMonth: { $lte: run.month } }],
    })
      .sort({ createdAt: 1 })
      .lean(),
    SalaryComponentModel.find({ organizationId: ctx.organizationId }).lean() as unknown as Promise<ComponentLean[]>,
  ]);
  const masterMap = new Map(masters.map((m) => [String(m._id), m]));
  const paidType = new Map(leaveTypes.map((t) => [String(t._id), t.paid !== false]));
  const group = <T extends { employeeId: unknown }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = String(r.employeeId);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  const structuresBy = group(structures);
  const leavesBy = group(leaves);
  const attendanceBy = group(attendance);
  const adjustmentsBy = group(adjustments);
  const loansBy = group(loans);

  const calendars = new Map<string, Promise<WorkCalendar>>();
  const calendarFor = (employeeId: Id, locationId: unknown) => {
    const key = String((locationId as { _id?: unknown } | null)?._id ?? locationId ?? 'none');
    if (!calendars.has(key)) calendars.set(key, buildWorkCalendar(ctx.organizationId, ps, pe, employeeId));
    return calendars.get(key)!;
  };

  const payslips: Record<string, unknown>[] = [];
  const adjustmentIds: Id[] = [];
  const warnings: string[] = [];
  const totals = { totalGross: 0, totalDeductions: 0, totalNet: 0, totalEmployerContributions: 0, employeeCount: 0 };

  for (const emp of employees) {
    const key = String(emp._id);
    const label = `${emp.employeeId} ${emp.firstName} ${emp.lastName}`;
    const joinKey = toDateKey(emp.joiningDate);
    const exitKey = emp.exitDate ? toDateKey(emp.exitDate) : null;
    const employedFrom = joinKey > ps ? joinKey : ps;
    const employedTo = exitKey && exitKey < pe ? exitKey : pe;
    if (employedFrom > employedTo) {
      warnings.push(`${label}: not employed during this period; skipped`);
      continue;
    }
    const structure = (structuresBy.get(key) ?? []).find(
      (s) => toDateKey(s.effectiveFrom) <= employedTo && (!s.effectiveTo || toDateKey(s.effectiveTo) >= employedTo),
    );
    if (!structure) {
      warnings.push(`${label}: no salary structure effective on ${employedTo}; skipped`);
      continue;
    }

    const calendar = await calendarFor(emp._id, emp.locationId);
    const days = computeDays({
      dates,
      kindOf: calendar.kindOf,
      employedFrom,
      employedTo,
      basis,
      leaves: (leavesBy.get(key) ?? []).map((l) => {
        const s = toDateKey(l.startDate);
        const e = toDateKey(l.endDate);
        return {
          dates: eachDateKey(s > ps ? s : ps, e < pe ? e : pe),
          halfDay: !!l.halfDay,
          paid: paidType.get(String(l.leaveTypeId)) ?? true,
        };
      }),
      attendance: (attendanceBy.get(key) ?? []).map((a) => ({ date: toDateKey(a.date), status: a.status ?? 'PRESENT', overtimeMinutes: a.overtimeMinutes ?? 0 })),
    });

    const engineInput = await engineInputFromStructure(ctx.organizationId, structure, masterMap);
    const full = evaluateSalary({ ...engineInput, factor: 1 });
    const overtimeHours = round2(days.overtimeMinutes / 60);
    const shiftHours = (emp.shiftId as { workingHours?: number } | null)?.workingHours || 8;
    const otAmount = overtimeAmount(full.gross, days.workingDays, shiftHours, overtimeHours, multiplier);
    let result = evaluateSalary({
      ...engineInput,
      factor: days.factor,
      extraEarnings: otAmount > 0 ? [{ code: 'OVERTIME', name: `Overtime (${overtimeHours} h)`, amount: otAmount }] : [],
    });
    result = applyPayrollRules(
      { countryRules, organizationId: String(ctx.organizationId), employeeId: key, month: run.month, year: run.year, currency: run.currency },
      result,
    );

    const earnings = result.earnings
      .filter((l) => l.amount > 0 || l.code === 'BASIC')
      .map((l) => ({ code: l.code, name: l.name, amount: l.amount, category: l.code === 'OVERTIME' ? 'OVERTIME' : 'STRUCTURE', refId: null as Id | null }));
    const deductions = result.deductions
      .filter((l) => l.amount > 0)
      .map((l) => ({ code: l.code, name: l.name, amount: l.amount, category: 'STRUCTURE', refId: null as Id | null }));
    const employerContributions = result.employerContributions
      .filter((l) => l.amount > 0)
      .map((l) => ({ code: l.code, name: l.name, amount: l.amount, category: 'STRUCTURE', refId: null as Id | null }));

    for (const adj of adjustmentsBy.get(key) ?? []) {
      const line = { code: adj.category, name: adj.description || adj.category, amount: round2(adj.amount), category: 'ADJUSTMENT', refId: adj._id };
      (adj.kind === 'EARNING' ? earnings : deductions).push(line);
      adjustmentIds.push(adj._id);
    }

    let gross = round2(earnings.reduce((s, l) => s + l.amount, 0));
    let totalDeductions = round2(deductions.reduce((s, l) => s + l.amount, 0));
    let available = Math.max(0, round2(gross - totalDeductions));
    for (const loan of loansBy.get(key) ?? []) {
      if (loan.repayments?.some((r) => r.month === run.month && r.year === run.year)) continue;
      const due = round2(Math.min(loan.monthlyInstallment, loan.outstanding));
      const amount = round2(Math.min(due, available));
      if (amount < due) warnings.push(`${label}: ${loan.type.toLowerCase()} recovery reduced to ${amount} (insufficient net pay)`);
      if (amount <= 0) continue;
      deductions.push({ code: loan.type, name: loan.type === 'LOAN' ? 'Loan recovery' : 'Salary advance recovery', amount, category: loan.type, refId: loan._id });
      available = round2(available - amount);
    }
    gross = round2(earnings.reduce((s, l) => s + l.amount, 0));
    totalDeductions = round2(deductions.reduce((s, l) => s + l.amount, 0));
    const net = round2(gross - totalDeductions);
    if (net < 0) warnings.push(`${label}: net pay is negative (${net})`);
    const employerTotal = round2(employerContributions.reduce((s, l) => s + l.amount, 0));

    const bank = (emp as { bank?: { bankName?: string; accountNumberMasked?: string } }).bank;
    payslips.push({
      organizationId: ctx.organizationId,
      payrollId: run._id,
      employeeId: emp._id,
      month: run.month,
      year: run.year,
      currency: run.currency,
      status: 'DRAFT',
      employeeSnapshot: {
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        workEmail: emp.workEmail,
        department: (emp.departmentId as { name?: string } | null)?.name,
        designation: (emp.designationId as { name?: string } | null)?.name,
        location: (emp.locationId as { name?: string } | null)?.name,
        joiningDate: emp.joiningDate,
        bankName: bank?.bankName,
        accountNumberMasked: bank?.accountNumberMasked,
      },
      structureId: structure._id,
      daysInPeriod: days.daysInPeriod,
      workingDays: days.workingDays,
      basisDays: days.basisDays,
      notEmployedDays: days.notEmployedDays,
      payableDays: days.paidDays,
      presentDays: days.presentDays,
      paidLeaveDays: days.paidLeaveDays,
      unpaidLeaveDays: days.unpaidLeaveDays,
      absentDays: days.absentDays,
      lopDays: days.lopDays,
      holidays: days.holidays,
      weekOffs: days.weekOffs,
      overtimeHours,
      prorationFactor: Math.round(days.factor * 10000) / 10000,
      earnings,
      deductions,
      employerContributions,
      grossEarnings: gross,
      totalDeductions,
      netPay: net,
    });
    totals.totalGross += gross;
    totals.totalDeductions += totalDeductions;
    totals.totalNet += net;
    totals.totalEmployerContributions += employerTotal;
    totals.employeeCount++;
  }

  return {
    payslips,
    adjustmentIds,
    warnings,
    totals: {
      totalGross: round2(totals.totalGross),
      totalDeductions: round2(totals.totalDeductions),
      totalNet: round2(totals.totalNet),
      totalEmployerContributions: round2(totals.totalEmployerContributions),
      employeeCount: totals.employeeCount,
    },
  };
};

/**
 * DRAFT/REVIEW → PROCESSING → (compute) → REVIEW. The PROCESSING state acts as
 * a lock; payslip replacement, adjustment linking and run totals are written
 * in one transaction. On failure the run returns to its previous state.
 */
export const processPayroll = async (ctx: RequestContext, id: string) => {
  const run = await loadRun(ctx, id);
  const from = run.status as PayrollStatus;
  assertTransition(from, 'PROCESSING');
  const locked = await PayrollModel.findOneAndUpdate(
    { _id: run._id, organizationId: ctx.organizationId, status: from },
    { $set: { status: 'PROCESSING' }, $push: { statusHistory: historyEntry(ctx, 'PROCESSING') } },
    { new: true },
  );
  if (!locked) throw conflict('This payroll is being modified by someone else. Please retry.', 'CONCURRENT_MODIFICATION');

  let computed: ComputedRun;
  try {
    computed = await computeRun(ctx, locked);
    await withTransaction(async (session) => {
      await PayslipModel.deleteMany({ organizationId: ctx.organizationId, payrollId: locked._id }, { session });
      await PayrollAdjustmentModel.updateMany({ organizationId: ctx.organizationId, payrollId: locked._id }, { $set: { payrollId: null } }, { session });
      if (computed.payslips.length) await PayslipModel.insertMany(computed.payslips, { session });
      if (computed.adjustmentIds.length) {
        const linked = await PayrollAdjustmentModel.updateMany(
          { organizationId: ctx.organizationId, _id: { $in: computed.adjustmentIds }, payrollId: null },
          { $set: { payrollId: locked._id } },
          { session },
        );
        if (linked.modifiedCount !== computed.adjustmentIds.length) {
          throw conflict('Some adjustments were included in another payroll run meanwhile. Please retry.', 'CONCURRENT_MODIFICATION');
        }
      }
      await PayrollModel.updateOne(
        { _id: locked._id, organizationId: ctx.organizationId, status: 'PROCESSING' },
        {
          $set: {
            status: 'REVIEW',
            ...computed.totals,
            warnings: computed.warnings,
            processedAt: new Date(),
            processedBy: ctx.userId,
          },
          $push: { statusHistory: historyEntry(ctx, 'REVIEW') },
        },
        { session },
      );
    });
  } catch (err) {
    const back: PayrollStatus = from === 'REVIEW' ? 'REVIEW' : 'DRAFT';
    await PayrollModel.updateOne(
      { _id: locked._id, status: 'PROCESSING' },
      { $set: { status: back }, $push: { statusHistory: historyEntry(ctx, back) } },
    );
    throw err;
  }

  await audit(ctx, {
    action: 'PAYROLL_PROCESSED',
    module: 'payroll',
    recordId: locked._id,
    recordLabel: runLabel(locked),
    newValues: { ...computed.totals, warnings: computed.warnings.length },
  });
  return getPayroll(ctx, id);
};

/** `POST /payroll/process` — by id, or the regular run of a month (created when missing). */
export const processByPeriod = async (ctx: RequestContext, input: { payrollId?: string; month?: number; year?: number }) => {
  if (input.payrollId) return processPayroll(ctx, input.payrollId);
  if (!input.month || !input.year) throw badRequest('Provide payrollId or month and year');
  const existing = await PayrollModel.findOne({ organizationId: ctx.organizationId, periodKey: periodKeyOf(input.year, input.month) }).select('_id').lean();
  if (existing) return processPayroll(ctx, String(existing._id));
  const created = await createPayroll(ctx, { month: input.month, year: input.year });
  return processPayroll(ctx, String(created._id));
};

/* ------------------------------ Transitions ------------------------------ */

export const approvePayroll = async (ctx: RequestContext, id: string) => {
  const run = await loadRun(ctx, id);
  assertTransition(run.status, 'APPROVED');
  if (run.processedBy && run.processedBy.equals(ctx.userId)) {
    const approvers = await userIdsWithPermission(ctx.organizationId, 'payroll:approve');
    if (approvers.some((u) => !u.equals(ctx.userId))) {
      throw forbidden('Payroll must be approved by someone other than the person who processed it', 'SELF_APPROVAL');
    }
  }
  await withTransaction(async (session) => {
    const res = await PayrollModel.updateOne(
      { _id: run._id, organizationId: ctx.organizationId, status: 'REVIEW' },
      { $set: { status: 'APPROVED', approvedAt: new Date(), approvedBy: ctx.userId }, $push: { statusHistory: historyEntry(ctx, 'APPROVED') } },
      { session },
    );
    if (!res.modifiedCount) throw conflict('This payroll was modified by someone else. Please retry.', 'CONCURRENT_MODIFICATION');
    await PayslipModel.updateMany({ organizationId: ctx.organizationId, payrollId: run._id }, { $set: { status: 'FINAL' } }, { session });
  });
  await audit(ctx, {
    action: 'PAYROLL_APPROVED',
    module: 'payroll',
    recordId: run._id,
    recordLabel: runLabel(run),
    oldValues: { status: 'REVIEW' },
    newValues: { status: 'APPROVED', totalNet: run.totalNet, employeeCount: run.employeeCount },
  });
  return getPayroll(ctx, id);
};

export const reopenPayroll = async (ctx: RequestContext, id: string) => {
  const run = await loadRun(ctx, id);
  assertTransition(run.status, 'REVIEW');
  if (run.status !== 'APPROVED') throw invalidTransition('Payroll', run.status, 'REVIEW');
  await withTransaction(async (session) => {
    const res = await PayrollModel.updateOne(
      { _id: run._id, organizationId: ctx.organizationId, status: 'APPROVED' },
      { $set: { status: 'REVIEW', approvedAt: null, approvedBy: null }, $push: { statusHistory: historyEntry(ctx, 'REVIEW') } },
      { session },
    );
    if (!res.modifiedCount) throw conflict('This payroll was modified by someone else. Please retry.', 'CONCURRENT_MODIFICATION');
    await PayslipModel.updateMany({ organizationId: ctx.organizationId, payrollId: run._id }, { $set: { status: 'DRAFT' } }, { session });
  });
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'payroll', recordId: run._id, recordLabel: runLabel(run), oldValues: { status: 'APPROVED' }, newValues: { status: 'REVIEW' } });
  return getPayroll(ctx, id);
};

export const cancelPayroll = async (ctx: RequestContext, id: string) => {
  const run = await loadRun(ctx, id);
  assertTransition(run.status, 'CANCELLED');
  const from = run.status;
  await withTransaction(async (session) => {
    const res = await PayrollModel.updateOne(
      { _id: run._id, organizationId: ctx.organizationId, status: from },
      { $set: { status: 'CANCELLED', periodKey: null }, $push: { statusHistory: historyEntry(ctx, 'CANCELLED') } },
      { session },
    );
    if (!res.modifiedCount) throw conflict('This payroll was modified by someone else. Please retry.', 'CONCURRENT_MODIFICATION');
    await PayslipModel.deleteMany({ organizationId: ctx.organizationId, payrollId: run._id }, { session });
    await PayrollAdjustmentModel.updateMany({ organizationId: ctx.organizationId, payrollId: run._id }, { $set: { payrollId: null } }, { session });
  });
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'payroll', recordId: run._id, recordLabel: runLabel(run), oldValues: { status: from }, newValues: { status: 'CANCELLED' } });
  return getPayroll(ctx, id);
};

/**
 * APPROVED → PAID: marks payslips paid, records loan repayments (closing
 * loans that reach zero), then notifies employees.
 */
export const payPayroll = async (
  ctx: RequestContext,
  id: string,
  input: { paymentDate: string; paymentReference?: string; paymentMode?: string },
) => {
  const run = await loadRun(ctx, id);
  assertTransition(run.status, 'PAID');
  const paymentDate = dateOnly(input.paymentDate);
  const payment = { paymentDate, paymentReference: input.paymentReference, paymentMode: input.paymentMode ?? 'BANK_TRANSFER' };

  await withTransaction(async (session) => {
    const res = await PayrollModel.updateOne(
      { _id: run._id, organizationId: ctx.organizationId, status: 'APPROVED' },
      { $set: { status: 'PAID', paidAt: new Date(), paidBy: ctx.userId, ...payment }, $push: { statusHistory: historyEntry(ctx, 'PAID') } },
      { session },
    );
    if (!res.modifiedCount) throw conflict('This payroll was modified by someone else. Please retry.', 'CONCURRENT_MODIFICATION');
    await PayslipModel.updateMany({ organizationId: ctx.organizationId, payrollId: run._id }, { $set: { status: 'PAID', ...payment } }, { session });

    const slips = await PayslipModel.find({ organizationId: ctx.organizationId, payrollId: run._id, 'deductions.category': { $in: ['LOAN', 'ADVANCE'] } })
      .select('deductions')
      .session(session ?? null)
      .lean();
    for (const slip of slips) {
      for (const d of slip.deductions.filter((x) => (x.category === 'LOAN' || x.category === 'ADVANCE') && x.refId)) {
        const loan = await LoanModel.findOne({ _id: d.refId, organizationId: ctx.organizationId }).session(session ?? null);
        if (!loan || loan.repayments.some((r) => r.payrollId && String(r.payrollId) === String(run._id))) continue;
        const amount = round2(Math.min(d.amount ?? 0, loan.outstanding));
        loan.repayments.push({ payrollId: run._id, amount, month: run.month, year: run.year, at: new Date() });
        loan.outstanding = round2(Math.max(0, loan.outstanding - amount));
        if (loan.outstanding <= 0) loan.status = 'CLOSED';
        await loan.save({ session });
      }
    }
  });

  await audit(ctx, {
    action: 'PAYROLL_PAID',
    module: 'payroll',
    recordId: run._id,
    recordLabel: runLabel(run),
    oldValues: { status: 'APPROVED' },
    newValues: { status: 'PAID', paymentDate: input.paymentDate, paymentMode: payment.paymentMode, totalNet: run.totalNet },
  });
  await notifyPayslipsPublished(ctx, run._id, runLabel(run));
  return getPayroll(ctx, id);
};

/* -------------------------------- Export --------------------------------- */

const csvCell = (value: unknown) => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`; // spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Payroll register / bank transfer sheet (masked account numbers only). */
export const exportPayroll = async (ctx: RequestContext, id: string, format: 'csv' | 'xlsx') => {
  const run = await PayrollModel.findOne({ _id: id, organizationId: ctx.organizationId }).lean();
  if (!run) throw notFound('Payroll');
  if (run.status === 'CANCELLED') throw unprocessable('A cancelled payroll cannot be exported');
  const slips = await PayslipModel.find({ organizationId: ctx.organizationId, payrollId: run._id }).sort({ 'employeeSnapshot.employeeId': 1 }).lean();
  const headers = [
    'Employee ID',
    'Name',
    'Department',
    'Designation',
    'Bank',
    'Account (masked)',
    'Payable days',
    'LOP days',
    'Gross earnings',
    'Total deductions',
    'Net pay',
    'Currency',
    'Status',
  ];
  const rows = slips.map((s) => [
    s.employeeSnapshot?.employeeId ?? '',
    s.employeeSnapshot?.name ?? '',
    s.employeeSnapshot?.department ?? '',
    s.employeeSnapshot?.designation ?? '',
    s.employeeSnapshot?.bankName ?? '',
    s.employeeSnapshot?.accountNumberMasked ?? '',
    s.payableDays ?? 0,
    s.lopDays ?? 0,
    s.grossEarnings,
    s.totalDeductions,
    s.netPay,
    s.currency,
    s.status,
  ]);
  const base = `payroll-${periodKeyOf(run.year, run.month)}${run.isOffCycle ? `-offcycle-${String(run._id).slice(-6)}` : ''}`;

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Stencil HRMS';
    const ws = wb.addWorksheet(`Payroll ${periodKeyOf(run.year, run.month)}`);
    ws.addRow(headers).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    ws.addRow([]);
    ws.addRow(['', 'Totals', '', '', '', '', '', '', run.totalGross, run.totalDeductions, run.totalNet]).font = { bold: true };
    ws.columns.forEach((c, i) => {
      c.width = i === 1 ? 28 : 16;
      if (i >= 8 && i <= 10) c.numFmt = '#,##0.00';
    });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, filename: `${base}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }

  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  return { buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'), filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8' };
};

/* -------------------------- Adjustments & loans -------------------------- */

const LOCKED_STATUSES = ['APPROVED', 'PAID'];

const assertAdjustmentEditable = async (ctx: RequestContext, payrollId: Id | null | undefined) => {
  if (!payrollId) return;
  const run = await PayrollModel.findOne({ _id: payrollId, organizationId: ctx.organizationId }).select('status').lean();
  if (run && LOCKED_STATUSES.includes(run.status ?? '')) {
    throw unprocessable('This adjustment belongs to an approved or paid payroll and cannot be changed', 'ADJUSTMENT_LOCKED');
  }
};

const assertEmployee = async (ctx: RequestContext, employeeId: string) => {
  const exists = await EmployeeModel.exists({ _id: employeeId, organizationId: ctx.organizationId, deletedAt: null });
  if (!exists) throw badRequest('Employee not found', 'INVALID_REFERENCE', [{ path: 'employeeId', message: 'Employee not found' }]);
};

const EMP_POPULATE = { path: 'employeeId', select: 'employeeId firstName lastName' };

export const adjustments = {
  list: (ctx: RequestContext, q: PaginationQuery & { employeeId?: string; payrollId?: string; month?: number; year?: number }) =>
    paginate(PayrollAdjustmentModel, {
      filter: {
        organizationId: ctx.organizationId,
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.payrollId ? { payrollId: q.payrollId } : {}),
        ...(q.month ? { month: q.month } : {}),
        ...(q.year ? { year: q.year } : {}),
      },
      page: q.page,
      limit: q.limit,
      sort: buildSort(q, ['year', 'month', 'amount', 'createdAt'], { year: -1, month: -1, createdAt: -1 }),
      populate: [EMP_POPULATE],
    }),
  get: async (ctx: RequestContext, id: string) => {
    const doc = await PayrollAdjustmentModel.findOne({ _id: id, organizationId: ctx.organizationId }).populate(EMP_POPULATE).lean();
    if (!doc) throw notFound('Adjustment');
    return doc;
  },
  create: async (ctx: RequestContext, input: { employeeId: string; month: number; year: number; kind: string; category: string; amount: number; description: string }) => {
    await assertEmployee(ctx, input.employeeId);
    const doc = await PayrollAdjustmentModel.create({ ...input, organizationId: ctx.organizationId, payrollId: null, createdBy: ctx.userId });
    await audit(ctx, { action: 'RECORD_CREATED', module: 'payroll', recordId: doc._id, recordLabel: `Adjustment ${input.category} ${input.month}/${input.year}`, newValues: input });
    return doc.toJSON();
  },
  update: async (ctx: RequestContext, id: string, input: Record<string, unknown>) => {
    const doc = await PayrollAdjustmentModel.findOne({ _id: id, organizationId: ctx.organizationId });
    if (!doc) throw notFound('Adjustment');
    await assertAdjustmentEditable(ctx, doc.payrollId);
    const before = doc.toObject() as Record<string, unknown>;
    // Moving an adjustment to another period detaches it from its (unapproved) run.
    if ((input.month !== undefined && input.month !== doc.month) || (input.year !== undefined && input.year !== doc.year)) doc.set('payrollId', null);
    doc.set(input);
    await doc.save();
    await audit(ctx, {
      action: 'RECORD_UPDATED',
      module: 'payroll',
      recordId: doc._id,
      recordLabel: `Adjustment ${doc.category} ${doc.month}/${doc.year}`,
      oldValues: Object.fromEntries(Object.keys(input).map((k) => [k, before[k]])),
      newValues: input,
    });
    return doc.toJSON();
  },
  remove: async (ctx: RequestContext, id: string) => {
    const doc = await PayrollAdjustmentModel.findOne({ _id: id, organizationId: ctx.organizationId });
    if (!doc) throw notFound('Adjustment');
    await assertAdjustmentEditable(ctx, doc.payrollId);
    await doc.deleteOne();
    await audit(ctx, { action: 'RECORD_DELETED', module: 'payroll', recordId: doc._id, recordLabel: `Adjustment ${doc.category} ${doc.month}/${doc.year}`, oldValues: { amount: doc.amount, kind: doc.kind } });
  },
};

export const loans = {
  list: (ctx: RequestContext, q: PaginationQuery & { employeeId?: string; status?: string }) =>
    paginate(LoanModel, {
      filter: {
        organizationId: ctx.organizationId,
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      page: q.page,
      limit: q.limit,
      sort: buildSort(q, ['createdAt', 'outstanding', 'principal'], { createdAt: -1 }),
      populate: [EMP_POPULATE],
    }),
  get: async (ctx: RequestContext, id: string) => {
    const doc = await LoanModel.findOne({ _id: id, organizationId: ctx.organizationId }).populate(EMP_POPULATE).lean();
    if (!doc) throw notFound('Loan');
    return doc;
  },
  create: async (
    ctx: RequestContext,
    input: { employeeId: string; type: string; principal: number; monthlyInstallment: number; startMonth: number; startYear: number; description?: string },
  ) => {
    await assertEmployee(ctx, input.employeeId);
    if (input.monthlyInstallment > input.principal) {
      throw badRequest('Installment cannot exceed the principal', 'VALIDATION_ERROR', [{ path: 'monthlyInstallment', message: 'Installment cannot exceed the principal' }]);
    }
    const doc = await LoanModel.create({ ...input, organizationId: ctx.organizationId, outstanding: input.principal, status: 'ACTIVE', createdBy: ctx.userId });
    await audit(ctx, {
      action: 'RECORD_CREATED',
      module: 'payroll',
      recordId: doc._id,
      recordLabel: `${input.type} ${input.principal}`,
      newValues: { type: input.type, principal: input.principal, monthlyInstallment: input.monthlyInstallment, startMonth: input.startMonth, startYear: input.startYear },
    });
    return doc.toJSON();
  },
  close: async (ctx: RequestContext, id: string) => {
    const doc = await LoanModel.findOne({ _id: id, organizationId: ctx.organizationId });
    if (!doc) throw notFound('Loan');
    if (doc.status === 'CLOSED') throw unprocessable('This loan is already closed', 'ALREADY_CLOSED');
    // Closing early writes off whatever is still outstanding.
    const outstandingBefore = doc.outstanding;
    const writtenOff = round2(Math.max(0, outstandingBefore));
    doc.status = 'CLOSED';
    doc.writtenOff = writtenOff;
    doc.outstanding = 0;
    await doc.save();
    await audit(ctx, {
      action: 'RECORD_UPDATED',
      module: 'payroll',
      recordId: doc._id,
      recordLabel: `${doc.type} ${doc.principal}`,
      oldValues: { status: 'ACTIVE', outstanding: outstandingBefore },
      newValues: { status: 'CLOSED', outstanding: 0, writtenOff },
    });
    return doc.toJSON();
  },
};
