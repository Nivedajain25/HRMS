import type { Types } from 'mongoose';
import { AttendanceCorrectionModel, AttendanceModel, EmployeeModel, ExpenseModel, GoalModel, LeaveRequestModel, OnboardingModel } from '../models';
import { can, type RequestContext } from '../types/context';
import { forbidden } from '../utils/errors';

export type ActivityType =
  | 'CLOCK_IN'
  | 'CLOCK_OUT'
  | 'LEAVE_APPLIED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'REGULARIZATION_REQUESTED'
  | 'REGULARIZATION_APPROVED'
  | 'REGULARIZATION_REJECTED'
  | 'EXPENSE_SUBMITTED'
  | 'EXPENSE_APPROVED'
  | 'EXPENSE_PAID'
  | 'GOAL_PROGRESS'
  | 'GOAL_COMPLETED'
  | 'TASK_DONE';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  at: Date;
  employee: { _id: Types.ObjectId; name: string; profilePhoto: string | null; designation: string | null };
  /** Verb phrase without the subject, e.g. "applied for Casual Leave" (the UI prefixes the name or "You"). */
  title: string;
  detail?: string;
  link?: string;
}

/** Who may see everyone's activity (HR / Head). Everyone else only sees their own. */
export const canSeeAllActivity = (ctx: RequestContext) => can(ctx, 'employee:read') || can(ctx, 'attendance:read');

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/**
 * Recent activity (default: last 7 days, newest first) gathered from attendance, leave, regularization, expenses,
 * goals and onboarding tasks. `scope=all` (HR / Head) covers every employee; otherwise only the caller.
 */
export const activityFeed = async (ctx: RequestContext, q: { scope?: 'all' | 'me'; limit?: number; days?: number }) => {
  const all = q.scope === 'all';
  if (all && !canSeeAllActivity(ctx)) throw forbidden();
  if (!all && !ctx.employeeId) return [];
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 50);
  const since = new Date(Date.now() - Math.min(Math.max(q.days ?? 7, 1), 31) * 86_400_000);
  const org = ctx.organizationId;
  const who = all ? {} : { employeeId: ctx.employeeId };
  const fmtDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: ctx.timezone });
  const money = (n: number, cur: string) => {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || ctx.currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${cur} ${n}`;
    }
  };

  // Company feed: no clock in / out for people not tracked for attendance (e.g. the super admin / owner).
  const exempt = all ? await EmployeeModel.find({ organizationId: org, attendanceExempt: true }).distinct('_id') : [];
  const attendanceWho = all && exempt.length ? { employeeId: { $nin: exempt } } : who;

  const [attendance, leaves, corrections, expenses, goals, onboardings] = await Promise.all([
    AttendanceModel.find({ organizationId: org, ...attendanceWho, $or: [{ checkIn: { $gte: since } }, { checkOut: { $gte: since } }] })
      .select('employeeId checkIn checkOut isLate lateMinutes workMode workingMinutes')
      .sort({ checkIn: -1 })
      .limit(limit * 2)
      .lean(),
    LeaveRequestModel.find({ organizationId: org, ...who, $or: [{ submittedAt: { $gte: since } }, { decidedAt: { $gte: since } }] })
      .select('employeeId leaveTypeId startDate endDate days halfDay status submittedAt decidedAt')
      .populate({ path: 'leaveTypeId', select: 'name' })
      .limit(limit * 2)
      .lean(),
    AttendanceCorrectionModel.find({ organizationId: org, ...who, $or: [{ submittedAt: { $gte: since } }, { decidedAt: { $gte: since } }] })
      .select('employeeId date status submittedAt decidedAt')
      .limit(limit * 2)
      .lean(),
    ExpenseModel.find({ organizationId: org, ...who, $or: [{ submittedAt: { $gte: since } }, { approvedAt: { $gte: since } }, { paidAt: { $gte: since } }] })
      .select('employeeId amount currency category description status submittedAt approvedAt paidAt')
      .limit(limit * 2)
      .lean(),
    GoalModel.find({ organizationId: org, ...who, deletedAt: null, 'updates.at': { $gte: since } })
      .select('employeeId title progress status updates')
      .limit(limit * 2)
      .lean(),
    OnboardingModel.find({ organizationId: org, ...who, 'tasks.completedAt': { $gte: since } })
      .select('employeeId tasks')
      .limit(limit * 2)
      .lean(),
  ]);

  type Raw = Omit<ActivityItem, 'employee'> & { employeeId: Types.ObjectId };
  const raw: Raw[] = [];
  const push = (r: Raw) => raw.push(r);

  for (const a of attendance) {
    if (a.checkIn && a.checkIn >= since)
      push({
        id: `in-${a._id}`,
        type: 'CLOCK_IN',
        at: a.checkIn,
        employeeId: a.employeeId,
        title: a.workMode === 'REMOTE' ? 'checked in remotely' : 'checked in',
        detail: a.isLate ? `Late by ${mins(a.lateMinutes ?? 0)}` : 'On time',
        link: '/attendance',
      });
    if (a.checkOut && a.checkOut >= since)
      push({ id: `out-${a._id}`, type: 'CLOCK_OUT', at: a.checkOut, employeeId: a.employeeId, title: 'checked out', detail: a.workingMinutes ? `Worked ${mins(a.workingMinutes)}` : undefined, link: '/attendance' });
  }

  for (const l of leaves) {
    const type = (l.leaveTypeId as unknown as { name?: string } | null)?.name ?? 'leave';
    const range = `${l.days} day${l.days === 1 ? '' : 's'} · ${fmtDate.format(l.startDate)}${+l.startDate !== +l.endDate ? ` – ${fmtDate.format(l.endDate)}` : ''}`;
    if (l.submittedAt && l.submittedAt >= since) push({ id: `la-${l._id}`, type: 'LEAVE_APPLIED', at: l.submittedAt, employeeId: l.employeeId, title: `applied for ${type}`, detail: range, link: `/leave/requests/${l._id}` });
    if (l.decidedAt && l.decidedAt >= since && (l.status === 'APPROVED' || l.status === 'REJECTED'))
      push({
        id: `ld-${l._id}`,
        type: l.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        at: l.decidedAt,
        employeeId: l.employeeId,
        title: `${type} was ${l.status === 'APPROVED' ? 'approved' : 'rejected'}`,
        detail: range,
        link: `/leave/requests/${l._id}`,
      });
  }

  for (const c of corrections) {
    const day = fmtDate.format(c.date);
    if (c.submittedAt && c.submittedAt >= since) push({ id: `ra-${c._id}`, type: 'REGULARIZATION_REQUESTED', at: c.submittedAt, employeeId: c.employeeId, title: 'requested attendance regularization', detail: `For ${day}`, link: '/regularization' });
    if (c.decidedAt && c.decidedAt >= since && (c.status === 'APPROVED' || c.status === 'REJECTED'))
      push({
        id: `rd-${c._id}`,
        type: c.status === 'APPROVED' ? 'REGULARIZATION_APPROVED' : 'REGULARIZATION_REJECTED',
        at: c.decidedAt,
        employeeId: c.employeeId,
        title: `regularization was ${c.status === 'APPROVED' ? 'approved' : 'rejected'}`,
        detail: `For ${day}`,
        link: '/regularization',
      });
  }

  for (const x of expenses) {
    const amount = money(x.amount, x.currency);
    if (x.submittedAt && x.submittedAt >= since) push({ id: `es-${x._id}`, type: 'EXPENSE_SUBMITTED', at: x.submittedAt, employeeId: x.employeeId, title: `submitted an expense of ${amount}`, detail: x.description, link: `/expenses/${x._id}` });
    if (x.approvedAt && x.approvedAt >= since) push({ id: `ea-${x._id}`, type: 'EXPENSE_APPROVED', at: x.approvedAt, employeeId: x.employeeId, title: `expense of ${amount} was approved`, detail: x.description, link: `/expenses/${x._id}` });
    if (x.paidAt && x.paidAt >= since) push({ id: `ep-${x._id}`, type: 'EXPENSE_PAID', at: x.paidAt, employeeId: x.employeeId, title: `got reimbursed ${amount}`, detail: x.description, link: `/expenses/${x._id}` });
  }

  for (const g of goals) {
    for (const [i, u] of (g.updates ?? []).entries()) {
      if (!u.at || u.at < since) continue;
      const done = u.status === 'COMPLETED' || (u.progress ?? 0) >= 100;
      push({
        id: `g-${g._id}-${i}`,
        type: done ? 'GOAL_COMPLETED' : 'GOAL_PROGRESS',
        at: u.at,
        employeeId: g.employeeId,
        title: done ? `completed the goal “${g.title}”` : `updated the goal “${g.title}” to ${Math.round(u.progress ?? 0)}%`,
        detail: u.note || undefined,
        link: `/performance/goals/${g._id}`,
      });
    }
  }

  for (const o of onboardings) {
    for (const t of o.tasks ?? []) {
      if (!t.completedAt || t.completedAt < since) continue;
      push({ id: `t-${o._id}-${String((t as { _id?: unknown })._id ?? t.title)}`, type: 'TASK_DONE', at: t.completedAt, employeeId: o.employeeId, title: `completed the task “${t.title}”`, detail: 'Onboarding', link: `/onboarding/${o._id}` });
    }
  }

  raw.sort((a, b) => +b.at - +a.at);
  const top = raw.slice(0, limit);
  const people = await EmployeeModel.find({ organizationId: org, _id: { $in: [...new Set(top.map((r) => String(r.employeeId)))] } })
    .select('firstName lastName profilePhoto designationId')
    .populate({ path: 'designationId', select: 'name' })
    .lean();
  const byId = new Map(people.map((p) => [String(p._id), p]));

  return top.flatMap(({ employeeId, ...r }): ActivityItem[] => {
    const p = byId.get(String(employeeId));
    if (!p) return [];
    return [
      {
        ...r,
        employee: {
          _id: p._id,
          name: `${p.firstName} ${p.lastName ?? ''}`.trim(),
          profilePhoto: p.profilePhoto ?? null,
          designation: (p.designationId as unknown as { name?: string } | null)?.name ?? null,
        },
      },
    ];
  });
};
