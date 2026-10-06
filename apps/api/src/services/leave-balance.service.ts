import { Types, type ClientSession } from 'mongoose';
import { EmployeeModel, LeaveBalanceModel, LeaveTypeModel, remainingBalance, type LeaveBalanceDoc } from '../models';
import type { RequestContext } from '../types/context';
import { badRequest, forbidden, notFound, unprocessable } from '../utils/errors';
import { withTransaction } from '../utils/transaction';
import { audit } from './audit.service';

interface EmployeeLike {
  _id: Types.ObjectId;
  gender?: string | null;
  joiningDate: Date;
}

interface LeaveTypeLike {
  _id: Types.ObjectId;
  annualAllowance: number;
  accrual?: string | null;
  applicableGenders?: string[] | null;
  active?: boolean | null;
}

const roundHalf = (n: number) => Math.round(n * 2) / 2;

export const isApplicable = (type: LeaveTypeLike, employee: EmployeeLike) =>
  !type.applicableGenders?.length || (!!employee.gender && type.applicableGenders.includes(employee.gender));

/**
 * Allocation for a leave year:
 *  - ANNUAL: full allowance, prorated by remaining months in the joining year.
 *  - MONTHLY: allowance/12 per completed-or-current month since start of year/joining.
 */
export const computeAllocation = (type: LeaveTypeLike, employee: EmployeeLike, year: number, asOf = new Date()) => {
  const joinYear = employee.joiningDate.getUTCFullYear();
  if (joinYear > year) return 0;
  const startMonth = joinYear === year ? employee.joiningDate.getUTCMonth() : 0; // 0-based
  if (type.accrual === 'MONTHLY') {
    const currentMonth = asOf.getUTCFullYear() > year ? 11 : asOf.getUTCFullYear() < year ? -1 : asOf.getUTCMonth();
    const months = Math.max(0, currentMonth - startMonth + 1);
    return roundHalf((type.annualAllowance / 12) * months);
  }
  const months = 12 - startMonth;
  return roundHalf((type.annualAllowance * months) / 12);
};

/** Creates missing balance rows for an employee for a year (idempotent). */
export const ensureLeaveBalances = async (
  organizationId: Types.ObjectId,
  employee: EmployeeLike,
  year: number,
  session?: ClientSession,
) => {
  const types = await LeaveTypeModel.find({ organizationId, active: true, deletedAt: null }).session(session ?? null).lean();
  const existing = await LeaveBalanceModel.find({ organizationId, employeeId: employee._id, year }).session(session ?? null).select('leaveTypeId').lean();
  const have = new Set(existing.map((b) => String(b.leaveTypeId)));
  const rows = types
    .filter((t) => !have.has(String(t._id)) && isApplicable(t, employee))
    .map((t) => {
      const allocated = computeAllocation(t, employee, year);
      return {
        organizationId,
        employeeId: employee._id,
        leaveTypeId: t._id,
        year,
        allocated,
        transactions: allocated ? [{ type: 'ALLOCATION', days: allocated, reason: `${year} allocation`, at: new Date() }] : [],
      };
    });
  if (!rows.length) return;
  try {
    await LeaveBalanceModel.insertMany(rows, { session, ordered: false });
  } catch (err) {
    // A concurrent request created the same rows (unique index); outside a
    // transaction that is harmless. Inside one, let the transaction retry.
    if (session || !isDuplicateKeyError(err)) throw err;
  }
};

const isDuplicateKeyError = (err: unknown) => {
  const e = err as { code?: number; writeErrors?: { code?: number }[] } | null;
  return e?.code === 11000 || (!!e?.writeErrors?.length && e.writeErrors.every((w) => w.code === 11000));
};

export const getBalanceDoc = async (
  organizationId: Types.ObjectId,
  employeeId: Types.ObjectId,
  leaveTypeId: Types.ObjectId,
  year: number,
  session?: ClientSession,
): Promise<LeaveBalanceDoc> => {
  let doc = await LeaveBalanceModel.findOne({ organizationId, employeeId, leaveTypeId, year }).session(session ?? null);
  if (!doc) {
    const employee = await EmployeeModel.findOne({ _id: employeeId, organizationId }).session(session ?? null).lean();
    if (!employee) throw notFound('Employee');
    await ensureLeaveBalances(organizationId, employee, year, session);
    doc = await LeaveBalanceModel.findOne({ organizationId, employeeId, leaveTypeId, year }).session(session ?? null);
    if (!doc) throw unprocessable('This leave type is not applicable to the employee', 'LEAVE_TYPE_NOT_APPLICABLE');
  }
  return doc;
};

type Op = 'RESERVE' | 'RELEASE' | 'CONSUME' | 'RESTORE' | 'CONSUME_DIRECT';

/**
 * Applies a ledger operation to a balance:
 *  RESERVE  pending += d        (request submitted)
 *  RELEASE  pending -= d        (pending request rejected/cancelled)
 *  CONSUME  pending -= d, used += d  (approved)
 *  RESTORE  used -= d           (approved leave cancelled)
 *  CONSUME_DIRECT used += d     (approved without a pending reservation)
 */
export const applyBalanceOp = async (
  balance: LeaveBalanceDoc,
  op: Op,
  days: number,
  meta: { leaveRequestId?: Types.ObjectId; by?: Types.ObjectId; reason?: string; allowNegative?: boolean },
  session?: ClientSession,
) => {
  switch (op) {
    case 'RESERVE':
      if (!meta.allowNegative && remainingBalance(balance) < days) {
        throw unprocessable(`Insufficient leave balance (available: ${remainingBalance(balance)} day(s))`, 'INSUFFICIENT_BALANCE');
      }
      balance.pending += days;
      break;
    case 'RELEASE':
      balance.pending = Math.max(0, balance.pending - days);
      break;
    case 'CONSUME':
      balance.pending = Math.max(0, balance.pending - days);
      balance.used += days;
      balance.transactions.push({ type: 'USED', days, reason: meta.reason, leaveRequestId: meta.leaveRequestId, by: meta.by, at: new Date() });
      break;
    case 'CONSUME_DIRECT':
      if (!meta.allowNegative && remainingBalance(balance) < days) {
        throw unprocessable(`Insufficient leave balance (available: ${remainingBalance(balance)} day(s))`, 'INSUFFICIENT_BALANCE');
      }
      balance.used += days;
      balance.transactions.push({ type: 'USED', days, reason: meta.reason, leaveRequestId: meta.leaveRequestId, by: meta.by, at: new Date() });
      break;
    case 'RESTORE':
      balance.used = Math.max(0, balance.used - days);
      balance.transactions.push({ type: 'RESTORED', days, reason: meta.reason, leaveRequestId: meta.leaveRequestId, by: meta.by, at: new Date() });
      break;
  }
  await balance.save({ session });
};

export const listBalances = async (organizationId: Types.ObjectId, employeeId: Types.ObjectId, year: number) => {
  const employee = await EmployeeModel.findOne({ _id: employeeId, organizationId }).lean();
  if (!employee) throw notFound('Employee');
  await ensureLeaveBalances(organizationId, employee, year);
  const rows = await LeaveBalanceModel.find({ organizationId, employeeId, year })
    .populate({ path: 'leaveTypeId', select: 'name code color paid isWorkFromHome halfDayAllowed active deletedAt' })
    .lean();
  type PopulatedType = { name: string; active?: boolean; deletedAt?: Date | null } | null;
  return rows
    .filter((r) => {
      const t = r.leaveTypeId as unknown as PopulatedType;
      // Archived/inactive types are only shown while they still carry activity.
      return !!t && ((t.active !== false && !t.deletedAt) || r.used > 0 || r.pending > 0);
    })
    .sort((a, b) => (a.leaveTypeId as unknown as { name: string }).name.localeCompare((b.leaveTypeId as unknown as { name: string }).name))
    .map((r) => ({
      _id: r._id,
      leaveType: r.leaveTypeId,
      year: r.year,
      opening: r.opening,
      allocated: r.allocated,
      carryForward: r.carryForward,
      adjusted: r.adjusted,
      used: r.used,
      pending: r.pending,
      encashed: r.encashed,
      remaining: remainingBalance(r),
      transactions: r.transactions.slice(-20),
    }));
};

export const adjustBalance = async (
  ctx: RequestContext,
  input: { employeeId: string; leaveTypeId: string; year: number; adjustment: number; reason: string },
) => {
  const employeeId = new Types.ObjectId(input.employeeId);
  const leaveTypeId = new Types.ObjectId(input.leaveTypeId);
  if (ctx.employeeId?.equals(employeeId)) throw forbidden('You cannot adjust your own leave balance');
  if (!(await EmployeeModel.exists({ _id: employeeId, organizationId: ctx.organizationId }))) throw notFound('Employee');
  if (!(await LeaveTypeModel.exists({ _id: leaveTypeId, organizationId: ctx.organizationId }))) throw notFound('Leave type');
  const balance = await getBalanceDoc(ctx.organizationId, employeeId, leaveTypeId, input.year);
  const before = remainingBalance(balance);
  if (before + input.adjustment < 0) throw badRequest('Adjustment would make the balance negative', 'NEGATIVE_BALANCE');
  balance.adjusted += input.adjustment;
  balance.transactions.push({ type: 'ADJUSTMENT', days: input.adjustment, reason: input.reason, by: ctx.userId, at: new Date() });
  await balance.save();
  await audit(ctx, {
    action: 'LEAVE_BALANCE_ADJUSTED',
    module: 'leave',
    recordId: balance._id,
    oldValues: { remaining: before },
    newValues: { remaining: remainingBalance(balance), adjustment: input.adjustment, reason: input.reason },
  });
  return balance.toJSON();
};

/**
 * Year-end carry forward: for leave types that allow it, moves up to
 * `maximumCarryForward` unused days into next year's balance. Idempotent:
 * re-running overwrites the carry-forward amount rather than adding to it.
 */
export const carryForward = async (organizationId: Types.ObjectId, fromYear: number, by?: Types.ObjectId) => {
  const types = await LeaveTypeModel.find({ organizationId, carryForward: true, deletedAt: null }).lean();
  let processed = 0;
  for (const type of types) {
    const balances = await LeaveBalanceModel.find({ organizationId, leaveTypeId: type._id, year: fromYear }).lean();
    for (const b of balances) {
      const amount = Math.max(0, Math.min(remainingBalance(b), type.maximumCarryForward || Infinity));
      await withTransaction(async (session) => {
        const next = await getBalanceDoc(organizationId, b.employeeId, type._id, fromYear + 1, session);
        const delta = amount - next.carryForward;
        next.carryForward = amount;
        if (delta !== 0) {
          next.transactions.push({ type: 'CARRY_FORWARD', days: delta, reason: `Carried forward from ${fromYear}`, by, at: new Date() });
        }
        await next.save({ session });
      });
      processed++;
    }
  }
  return { processed };
};

/** Monthly accrual refresh: recomputes `allocated` for MONTHLY leave types. */
export const refreshMonthlyAccruals = async (organizationId: Types.ObjectId, year: number, asOf = new Date()) => {
  const types = await LeaveTypeModel.find({ organizationId, accrual: 'MONTHLY', active: true, deletedAt: null }).lean();
  if (!types.length) return { updated: 0 };
  const employees = await EmployeeModel.find({ organizationId, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } }).lean();
  let updated = 0;
  for (const emp of employees) {
    await ensureLeaveBalances(organizationId, emp, year);
    for (const type of types) {
      if (!isApplicable(type, emp)) continue;
      const target = computeAllocation(type, emp, year, asOf);
      const bal = await LeaveBalanceModel.findOne({ organizationId, employeeId: emp._id, leaveTypeId: type._id, year });
      if (bal && bal.allocated !== target) {
        bal.transactions.push({ type: 'ALLOCATION', days: target - bal.allocated, reason: 'Monthly accrual', at: new Date() });
        bal.allocated = target;
        await bal.save();
        updated++;
      }
    }
  }
  return { updated };
};
