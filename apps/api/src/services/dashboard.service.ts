import type { Types } from 'mongoose';
import {
  AttendanceCorrectionModel,
  AttendanceModel,
  AuditLogModel,
  CandidateModel,
  DepartmentModel,
  DocumentModel,
  EmployeeModel,
  ExpenseModel,
  GoalModel,
  JobOpeningModel,
  LeaveRequestModel,
  LeaveTypeModel,
  NotificationModel,
  OffboardingModel,
  OnboardingModel,
  PayrollModel,
  PayslipModel,
  PerformanceReviewModel,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { addDaysKey, dateOnly, minutesBetween, toDateKey, todayKey } from '../utils/dates';
import { latestVisible } from './announcement.service';
import { approvalQueueFilter, type ApprovalPolicy } from './approval.service';
import { buildWorkCalendar, holidaysInRange } from './calendar.service';
import { listBalances } from './leave-balance.service';
import { getDirectReportIds, getReportIds } from './scope.service';

/* ------------------------------- Helpers ------------------------------ */

const PENDING = ['SUBMITTED', 'PENDING_APPROVAL'];
const ACTIVE = { deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } };
const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'HALF_DAY', 'WORK_FROM_HOME']);

/** Approval policies used for "awaiting me" queues (mirrors each module's policy). */
export const LEAVE_POLICY: ApprovalPolicy = { approvePermission: 'leave:approve', rejectPermission: 'leave:reject', hrPermission: 'leave:read' };
export const EXPENSE_POLICY: ApprovalPolicy = {
  approvePermission: 'expense:approve',
  rejectPermission: 'expense:reject',
  hrPermission: 'expense:read',
  financePermission: 'expense:pay',
};
export const REGULARIZATION_POLICY: ApprovalPolicy = { approvePermission: 'attendance:approve', hrPermission: 'attendance:read' };

const pad = (n: number) => String(n).padStart(2, '0');
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dayDiff = (a: string, b: string) => Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86_400_000);

/** Month keys (`YYYY-MM`) ending with the month of `today`, oldest first. */
const lastMonths = (today: string, count: number) => {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  }
  return out;
};
const monthEnd = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number);
  return toDateKey(new Date(Date.UTC(y!, m!, 0)));
};

/** Next occurrence (on or after `today`) of a date's month/day. */
const nextOccurrence = (date: Date, today: string) => {
  const md = toDateKey(date).slice(5);
  const make = (yr: number) => (md === '02-29' && !isLeap(yr) ? `${yr}-02-28` : `${yr}-${md}`);
  const y = Number(today.slice(0, 4));
  let key = make(y);
  if (key < today) key = make(y + 1);
  return { key, inDays: dayDiff(today, key) };
};

const person = (e: { _id: Types.ObjectId; employeeId?: string; firstName: string; lastName: string; profilePhoto?: string | null }) => ({
  _id: e._id,
  employeeId: e.employeeId,
  name: `${e.firstName} ${e.lastName}`,
  profilePhoto: e.profilePhoto ?? null,
});

const refName = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name?: string }).name ?? '') : null);
const refPerson = (v: unknown) => {
  const p = v as { firstName?: string; lastName?: string } | null;
  return p?.firstName ? `${p.firstName} ${p.lastName ?? ''}`.trim() : null;
};

interface DaySummary {
  date: string;
  present: number;
  late: number;
  /** Present and not late. */
  onTime: number;
  workFromHome: number;
  absent: number;
  onLeave: number;
  notCheckedIn: number;
  isWorkingDay: boolean;
}

/** Attendance picture for one day, optionally limited to a set of employees. */
const summarizeDay = async (
  organizationId: Types.ObjectId,
  dateKey: string,
  employeeIds: Types.ObjectId[] | null,
  headcount: number,
): Promise<DaySummary> => {
  const scope = employeeIds ? { employeeId: { $in: employeeIds } } : {};
  const day = dateOnly(dateKey);
  const [records, leaves, calendar] = await Promise.all([
    AttendanceModel.find({ organizationId, date: day, ...scope }).select('employeeId status isLate workMode checkIn').lean(),
    LeaveRequestModel.find({ organizationId, status: 'APPROVED', startDate: { $lte: day }, endDate: { $gte: day }, ...scope })
      .select('employeeId leaveTypeId')
      .populate({ path: 'leaveTypeId', select: 'isWorkFromHome' })
      .lean(),
    buildWorkCalendar(organizationId, dateKey, dateKey),
  ]);
  const present = new Set<string>();
  const late = new Set<string>();
  const wfh = new Set<string>();
  const absent = new Set<string>();
  const onLeave = new Set<string>();
  for (const r of records) {
    const id = String(r.employeeId);
    if (PRESENT_STATUSES.has(r.status) || (r.checkIn && r.status !== 'LEAVE' && r.status !== 'ABSENT')) present.add(id);
    if (r.isLate || r.status === 'LATE') late.add(id);
    if (r.status === 'WORK_FROM_HOME' || r.workMode === 'REMOTE') wfh.add(id);
    if (r.status === 'ABSENT') absent.add(id);
    if (r.status === 'LEAVE') onLeave.add(id);
  }
  for (const l of leaves) {
    const id = String(l.employeeId);
    const isWfh = (l.leaveTypeId as unknown as { isWorkFromHome?: boolean } | null)?.isWorkFromHome;
    if (isWfh) continue;
    if (!present.has(id)) onLeave.add(id);
  }
  for (const id of onLeave) absent.delete(id);
  const isWorkingDay = calendar.kindOf(dateKey) === 'WORKING';
  return {
    date: dateKey,
    present: present.size,
    late: late.size,
    onTime: [...present].filter((id) => !late.has(id)).length,
    workFromHome: wfh.size,
    absent: absent.size,
    onLeave: onLeave.size,
    notCheckedIn: isWorkingDay ? Math.max(0, headcount - present.size - absent.size - onLeave.size) : 0,
    isWorkingDay,
  };
};

const upcomingDates = async (organizationId: Types.ObjectId, today: string, field: 'dateOfBirth' | 'joiningDate', days = 30) => {
  const emps = await EmployeeModel.find({ organizationId, ...ACTIVE, [field]: { $ne: null } })
    .select(`employeeId firstName lastName profilePhoto departmentId ${field}`)
    .populate({ path: 'departmentId', select: 'name' })
    .lean();
  const thisYear = Number(today.slice(0, 4));
  return emps
    .map((e) => {
      const d = e[field] as Date | null | undefined;
      if (!d) return null;
      const next = nextOccurrence(d, today);
      const years = Number(next.key.slice(0, 4)) - d.getUTCFullYear();
      return { e, d, next, years };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.next.inDays <= days && (field === 'dateOfBirth' || (x.years >= 1 && x.d.getUTCFullYear() <= thisYear)))
    .sort((a, b) => a.next.inDays - b.next.inDays)
    .slice(0, 20)
    .map(({ e, next, years }) => ({
      ...person(e),
      department: refName(e.departmentId),
      // Month/day only — the birth year is never exposed.
      date: next.key.slice(5),
      nextDate: next.key,
      inDays: next.inDays,
      ...(field === 'joiningDate' ? { years } : {}),
    }));
};

/** Top pending approvals awaiting the current user across modules. */
const pendingApprovalsFor = async (ctx: RequestContext, limit = 10) => {
  const org = ctx.organizationId;
  const [leaveF, expenseF, regF] = await Promise.all([
    approvalQueueFilter(ctx, LEAVE_POLICY),
    approvalQueueFilter(ctx, EXPENSE_POLICY),
    approvalQueueFilter(ctx, REGULARIZATION_POLICY),
  ]);
  const empPopulate = { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' };
  const [leaves, expenses, regs] = await Promise.all([
    leaveF
      ? LeaveRequestModel.find({ organizationId: org, status: { $in: PENDING }, ...leaveF })
          .sort({ submittedAt: -1, createdAt: -1 })
          .limit(limit)
          .populate(empPopulate)
          .populate({ path: 'leaveTypeId', select: 'name code' })
          .lean()
      : [],
    expenseF
      ? ExpenseModel.find({ organizationId: org, status: { $in: PENDING }, ...expenseF })
          .sort({ submittedAt: -1, createdAt: -1 })
          .limit(limit)
          .populate(empPopulate)
          .lean()
      : [],
    regF
      ? AttendanceCorrectionModel.find({ organizationId: org, status: { $in: PENDING }, ...regF })
          .sort({ submittedAt: -1, createdAt: -1 })
          .limit(limit)
          .populate(empPopulate)
          .lean()
      : [],
  ]);
  const items = [
    ...leaves.map((l) => ({
      type: 'leave' as const,
      id: String(l._id),
      employee: refPerson(l.employeeId),
      summary: `${refName(l.leaveTypeId) ?? 'Leave'} · ${l.days} day(s) from ${toDateKey(l.startDate)}`,
      awaiting: l.currentApproverType,
      submittedAt: l.submittedAt ?? l.createdAt,
      url: `/leave/requests/${l._id}`,
    })),
    ...expenses.map((x) => ({
      type: 'expense' as const,
      id: String(x._id),
      employee: refPerson(x.employeeId),
      summary: `${x.expenseNumber} · ${x.category} · ${x.amount} ${x.currency}`,
      awaiting: x.currentApproverType,
      submittedAt: x.submittedAt ?? x.createdAt,
      url: `/expenses/${x._id}`,
    })),
    ...regs.map((r) => ({
      type: 'regularization' as const,
      id: String(r._id),
      employee: refPerson(r.employeeId),
      summary: `Attendance correction for ${toDateKey(r.date)} (${r.requestedCheckIn}–${r.requestedCheckOut})`,
      awaiting: r.currentApproverType,
      submittedAt: r.submittedAt ?? r.createdAt,
      url: `/attendance/regularizations/${r._id}`,
    })),
  ];
  return items
    .sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime())
    .slice(0, limit);
};

/* -------------------------------- Admin ------------------------------- */

export const adminDashboard = async (ctx: RequestContext) => {
  const org = ctx.organizationId;
  const today = todayKey(ctx.timezone);
  const activeFilter = { organizationId: org, ...ACTIVE };

  const [totalEmployees, activeEmployees, trackedEmployees, newEmployees, openJobs, pendingLeave, pendingReg, pendingExp] = await Promise.all([
    EmployeeModel.countDocuments({ organizationId: org, deletedAt: null }),
    EmployeeModel.countDocuments(activeFilter),
    // Today's attendance counts only people whose attendance is tracked (not e.g. the owner).
    EmployeeModel.countDocuments({ ...activeFilter, attendanceExempt: { $ne: true } }),
    EmployeeModel.countDocuments({ ...activeFilter, joiningDate: { $gte: dateOnly(addDaysKey(today, -30)), $lte: dateOnly(today) } }),
    JobOpeningModel.countDocuments({ organizationId: org, deletedAt: null, status: 'OPEN' }),
    LeaveRequestModel.countDocuments({ organizationId: org, status: { $in: PENDING } }),
    AttendanceCorrectionModel.countDocuments({ organizationId: org, status: { $in: PENDING } }),
    ExpenseModel.countDocuments({ organizationId: org, status: { $in: PENDING } }),
  ]);
  const todaySummary = await summarizeDay(org, today, null, trackedEmployees);

  let payroll = null;
  let payrollPrevious = null;
  if (can(ctx, 'payroll:read')) {
    const [last, previous] = await PayrollModel.find({ organizationId: org, status: { $ne: 'CANCELLED' }, isOffCycle: { $ne: true } })
      .sort({ year: -1, month: -1, createdAt: -1 })
      .limit(2)
      .select('month year status totalNet totalGross employeeCount currency')
      .lean();
    payroll = last
      ? { month: last.month, year: last.year, status: last.status, totalNet: last.totalNet, totalGross: last.totalGross, employeeCount: last.employeeCount, currency: last.currency }
      : null;
    payrollPrevious = previous ? { month: previous.month, year: previous.year, totalNet: previous.totalNet, currency: previous.currency } : null;
  }

  /* Role dashboards (HR / Head): this month's people movement, pipelines and attendance rate */
  const monthStart = `${today.slice(0, 7)}-01`;
  const personRow = (e: { _id: Types.ObjectId; firstName: string; lastName: string; profilePhoto?: string | null; designationId?: unknown; departmentId?: unknown }, date: Date | null | undefined) => ({
    _id: e._id,
    name: `${e.firstName} ${e.lastName ?? ''}`.trim(),
    profilePhoto: e.profilePhoto ?? null,
    designation: (e.designationId as { name?: string } | null)?.name ?? null,
    department: (e.departmentId as { name?: string } | null)?.name ?? null,
    date: date ? toDateKey(date) : null,
  });
  const personPopulate = [
    { path: 'designationId', select: 'name' },
    { path: 'departmentId', select: 'name' },
  ];
  const [joinersThisMonth, exitsThisMonth, onboardingInProgress, offboardingInProgress, pipeline, monthAttendance] = await Promise.all([
    EmployeeModel.find({ organizationId: org, deletedAt: null, joiningDate: { $gte: dateOnly(monthStart), $lte: dateOnly(today) } })
      .select('firstName lastName profilePhoto designationId departmentId joiningDate')
      .populate(personPopulate)
      .sort({ joiningDate: -1 })
      .limit(8)
      .lean(),
    EmployeeModel.find({ organizationId: org, exitDate: { $gte: dateOnly(monthStart), $lte: dateOnly(monthEnd(today.slice(0, 7))) } })
      .select('firstName lastName profilePhoto designationId departmentId exitDate')
      .populate(personPopulate)
      .sort({ exitDate: 1 })
      .limit(8)
      .lean(),
    OnboardingModel.countDocuments({ organizationId: org, status: { $in: ['PENDING', 'IN_PROGRESS'] } }),
    OffboardingModel.countDocuments({ organizationId: org, status: { $nin: ['COMPLETED', 'CANCELLED'] } }),
    can(ctx, 'recruitment:read')
      ? CandidateModel.countDocuments({ organizationId: org, deletedAt: null, stage: { $in: ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'ASSESSMENT', 'SELECTED', 'OFFERED'] } })
      : Promise.resolve(null),
    AttendanceModel.aggregate<{ _id: null; present: number; absent: number }>([
      { $match: { organizationId: org, date: { $gte: dateOnly(monthStart), $lte: dateOnly(today) } } },
      {
        $group: {
          _id: null,
          present: { $sum: { $cond: [{ $in: ['$status', [...PRESENT_STATUSES]] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
        },
      },
    ]),
  ]);
  // Latest joiners (any month) and probation periods ending in the next 30 days.
  const [recentJoiners, onProbation] = await Promise.all([
    EmployeeModel.find({ organizationId: org, ...ACTIVE, joiningDate: { $lte: dateOnly(today) } })
      .select('firstName lastName profilePhoto designationId departmentId joiningDate')
      .populate(personPopulate)
      .sort({ joiningDate: -1 })
      .limit(5)
      .lean(),
    EmployeeModel.find({ organizationId: org, deletedAt: null, employmentStatus: 'PROBATION', confirmationDate: null })
      .select('joiningDate probationPeriodDays')
      .lean(),
  ]);
  const todayMs = dateOnly(today).getTime();
  const probationEndingSoon = onProbation.filter((e) => {
    if (!e.joiningDate) return false;
    const end = e.joiningDate.getTime() + (e.probationPeriodDays ?? 90) * 86_400_000;
    return end >= todayMs && end <= todayMs + 30 * 86_400_000;
  }).length;

  const att = monthAttendance[0];
  const attendanceRateMonth = att && att.present + att.absent > 0 ? Math.round((att.present / (att.present + att.absent)) * 1000) / 10 : null;

  /* Charts */
  const months12 = lastMonths(today, 12);
  const people = await EmployeeModel.find({ organizationId: org }).select('joiningDate exitDate deletedAt employmentStatus').lean();
  const employeeGrowth = months12.map((m) => {
    const end = dateOnly(monthEnd(m));
    const start = dateOnly(`${m}-01`);
    const leftAt = (p: (typeof people)[number]) => p.exitDate ?? (p.employmentStatus === 'ARCHIVED' || p.employmentStatus === 'EXITED' ? p.deletedAt : null) ?? null;
    let headcount = 0;
    let joined = 0;
    let exited = 0;
    for (const p of people) {
      const left = leftAt(p);
      if (p.joiningDate <= end && (!left || left > end)) headcount++;
      if (p.joiningDate >= start && p.joiningDate <= end) joined++;
      if (left && left >= start && left <= end) exited++;
    }
    return { month: m, headcount, joined, exited };
  });

  const trendFrom = addDaysKey(today, -13);
  const attAgg = await AttendanceModel.aggregate<{ _id: { d: string; s: string; late: boolean }; n: number }>([
    { $match: { organizationId: org, date: { $gte: dateOnly(trendFrom), $lte: dateOnly(today) } } },
    { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, s: '$status', late: '$isLate' }, n: { $sum: 1 } } },
  ]);
  const attendanceTrend = Array.from({ length: 14 }, (_, i) => addDaysKey(trendFrom, i)).map((d) => {
    const rows = attAgg.filter((r) => r._id.d === d);
    const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((a, r) => a + r.n, 0);
    return {
      date: d,
      present: sum((r) => PRESENT_STATUSES.has(r._id.s)),
      absent: sum((r) => r._id.s === 'ABSENT'),
      late: sum((r) => r._id.s === 'LATE' || (r._id.late && PRESENT_STATUSES.has(r._id.s))),
      onLeave: sum((r) => r._id.s === 'LEAVE'),
    };
  });

  const months6 = lastMonths(today, 6);
  const [leaveAgg, leaveTypes] = await Promise.all([
    LeaveRequestModel.aggregate<{ _id: { m: string; t: Types.ObjectId }; days: number }>([
      { $match: { organizationId: org, status: 'APPROVED', startDate: { $gte: dateOnly(`${months6[0]}-01`), $lte: dateOnly(monthEnd(months6[5]!)) } } },
      { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$startDate' } }, t: '$leaveTypeId' }, days: { $sum: '$days' } } },
    ]),
    LeaveTypeModel.find({ organizationId: org }).select('name code color').lean(),
  ]);
  const typeById = new Map(leaveTypes.map((t) => [String(t._id), t]));
  const usedTypes = [...new Set(leaveAgg.map((r) => String(r._id.t)))].map((id) => typeById.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  const leaveTrend = {
    types: usedTypes.map((t) => ({ code: t.code, name: t.name, color: t.color })),
    months: months6.map((m) => {
      const byType: Record<string, number> = {};
      for (const r of leaveAgg.filter((x) => x._id.m === m)) {
        const code = typeById.get(String(r._id.t))?.code ?? 'OTHER';
        byType[code] = (byType[code] ?? 0) + r.days;
      }
      return { month: m, byType, total: Object.values(byType).reduce((a, b) => a + b, 0) };
    }),
  };

  const [deptAgg, typeAgg] = await Promise.all([
    EmployeeModel.aggregate<{ _id: Types.ObjectId | null; count: number }>([{ $match: activeFilter }, { $group: { _id: '$departmentId', count: { $sum: 1 } } }]),
    EmployeeModel.aggregate<{ _id: string; count: number }>([{ $match: activeFilter }, { $group: { _id: '$employmentType', count: { $sum: 1 } } }]),
  ]);
  const depts = await DepartmentModel.find({ organizationId: org, _id: { $in: deptAgg.map((d) => d._id).filter(Boolean) } }).select('name code').lean();
  const deptName = new Map(depts.map((d) => [String(d._id), d.name]));
  const departmentDistribution = deptAgg
    .map((d) => ({ departmentId: d._id, name: d._id ? (deptName.get(String(d._id)) ?? 'Unknown') : 'Unassigned', count: d.count }))
    .sort((a, b) => b.count - a.count);
  const employmentTypeDistribution = typeAgg.map((t) => ({ type: t._id ?? 'UNSPECIFIED', count: t.count })).sort((a, b) => b.count - a.count);

  /* Widgets */
  const docFilter: Record<string, unknown> = {
    organizationId: org,
    deletedAt: null,
    isLatest: true,
    expiryDate: { $gte: dateOnly(today), $lte: dateOnly(addDaysKey(today, 30)) },
  };
  if (!can(ctx, 'document:read')) {
    docFilter.employeeId = ctx.employeeId ?? null;
    docFilter.confidential = false;
  }
  const [upcomingBirthdays, workAnniversaries, expiring, recent, pendingApprovals] = await Promise.all([
    upcomingDates(org, today, 'dateOfBirth'),
    upcomingDates(org, today, 'joiningDate'),
    DocumentModel.find(docFilter)
      .sort({ expiryDate: 1 })
      .limit(10)
      .select('title category expiryDate employeeId')
      .populate({ path: 'employeeId', select: 'employeeId firstName lastName' })
      .lean(),
    can(ctx, 'audit:read')
      ? AuditLogModel.find({ organizationId: org }).sort({ timestamp: -1 }).limit(10).select('action module recordId recordLabel userName timestamp').lean()
      : [],
    pendingApprovalsFor(ctx),
  ]);

  return {
    cards: {
      totalEmployees,
      activeEmployees,
      newEmployees,
      presentToday: todaySummary.present,
      absentToday: todaySummary.absent,
      onLeaveToday: todaySummary.onLeave,
      lateToday: todaySummary.late,
      onTimeToday: todaySummary.onTime,
      notCheckedInToday: todaySummary.notCheckedIn,
      pendingApprovals: { leave: pendingLeave, regularization: pendingReg, expense: pendingExp, total: pendingLeave + pendingReg + pendingExp },
      payroll,
      openJobs,
    },
    charts: { employeeGrowth, attendanceTrend, leaveTrend, departmentDistribution, employmentTypeDistribution },
    widgets: {
      upcomingBirthdays,
      workAnniversaries,
      expiringDocuments: expiring.map((d) => ({
        _id: d._id,
        title: d.title,
        category: d.category,
        expiryDate: d.expiryDate ? toDateKey(d.expiryDate) : null,
        employee: refPerson(d.employeeId),
      })),
      recentActivities: recent,
      pendingApprovals,
    },
    insights: {
      joinersThisMonth: joinersThisMonth.map((e) => personRow(e, e.joiningDate)),
      exitsThisMonth: exitsThisMonth.map((e) => personRow(e, e.exitDate)),
      /** The five latest joiners, any month. */
      recentJoiners: recentJoiners.map((e) => personRow(e, e.joiningDate)),
      /** Employees on probation whose period ends within 30 days. */
      probationEndingSoon,
      onboardingInProgress,
      offboardingInProgress,
      /** Candidates in active stages (null without recruitment:read). */
      pipeline,
      /** Present ÷ (present + absent) records this month, %. */
      attendanceRateMonth,
      /** The payroll run before `cards.payroll` (for month-on-month change). */
      payrollPrevious,
    },
    date: today,
  };
};

/* ------------------------------- Manager ------------------------------ */

export const managerDashboard = async (ctx: RequestContext) => {
  const org = ctx.organizationId;
  const today = todayKey(ctx.timezone);
  if (!ctx.employeeId) {
    return { teamSize: 0, directReports: 0, attendanceToday: null, pendingLeave: { count: 0, items: [] }, goals: null, reviews: { count: 0, items: [] }, pendingExpenses: { count: 0, totalAmount: 0, items: [] } };
  }
  const [allReports, direct] = await Promise.all([getReportIds(org, ctx.employeeId), getDirectReportIds(org, ctx.employeeId)]);
  const activeTeam = await EmployeeModel.find({ organizationId: org, _id: { $in: allReports }, ...ACTIVE }).select('_id').lean();
  const team = activeTeam.map((e) => e._id);
  const empPopulate = { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' };

  const [attendanceToday, pendingLeaveCount, pendingLeaveItems, goalAgg, reviewItems, reviewCount, expenseAgg, expenseItems] = await Promise.all([
    summarizeDay(org, today, team, team.length),
    LeaveRequestModel.countDocuments({ organizationId: org, employeeId: { $in: team }, status: { $in: PENDING } }),
    LeaveRequestModel.find({ organizationId: org, employeeId: { $in: team }, status: { $in: PENDING } })
      .sort({ startDate: 1 })
      .limit(10)
      .populate(empPopulate)
      .populate({ path: 'leaveTypeId', select: 'name code color' })
      .select('employeeId leaveTypeId startDate endDate days status currentApproverType')
      .lean(),
    GoalModel.aggregate<{ _id: string; count: number; progress: number }>([
      { $match: { organizationId: org, employeeId: { $in: team }, deletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 }, progress: { $sum: '$progress' } } },
    ]),
    PerformanceReviewModel.find({ organizationId: org, status: 'PENDING_MANAGER', $or: [{ managerId: ctx.employeeId }, { employeeId: { $in: direct } }] })
      .limit(10)
      .populate(empPopulate)
      .populate({ path: 'cycleId', select: 'name managerReviewDue' })
      .select('employeeId cycleId status')
      .lean(),
    PerformanceReviewModel.countDocuments({ organizationId: org, status: 'PENDING_MANAGER', $or: [{ managerId: ctx.employeeId }, { employeeId: { $in: direct } }] }),
    ExpenseModel.aggregate<{ _id: string; count: number; amount: number }>([
      { $match: { organizationId: org, employeeId: { $in: team }, status: { $in: PENDING } } },
      { $group: { _id: '$currency', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    ExpenseModel.find({ organizationId: org, employeeId: { $in: team }, status: { $in: PENDING } })
      .sort({ submittedAt: -1, createdAt: -1 })
      .limit(10)
      .populate(empPopulate)
      .select('expenseNumber employeeId category amount currency date status currentApproverType')
      .lean(),
  ]);

  const activeGoals = goalAgg.filter((g) => g._id !== 'CANCELLED');
  const goalCount = activeGoals.reduce((a, g) => a + g.count, 0);
  return {
    teamSize: team.length,
    directReports: direct.length,
    attendanceToday,
    pendingLeave: {
      count: pendingLeaveCount,
      items: pendingLeaveItems.map((l) => ({
        _id: l._id,
        employee: refPerson(l.employeeId),
        leaveType: l.leaveTypeId,
        startDate: toDateKey(l.startDate),
        endDate: toDateKey(l.endDate),
        days: l.days,
        status: l.status,
        awaiting: l.currentApproverType,
      })),
    },
    goals: {
      total: goalCount,
      averageProgress: goalCount ? Math.round(activeGoals.reduce((a, g) => a + g.progress, 0) / goalCount) : 0,
      byStatus: Object.fromEntries(goalAgg.map((g) => [g._id, g.count])),
    },
    reviews: {
      count: reviewCount,
      items: reviewItems.map((r) => ({ _id: r._id, employee: refPerson(r.employeeId), cycle: refName(r.cycleId), status: r.status })),
    },
    pendingExpenses: {
      count: expenseAgg.reduce((a, e) => a + e.count, 0),
      totals: expenseAgg.map((e) => ({ currency: e._id, amount: Math.round(e.amount * 100) / 100, count: e.count })),
      items: expenseItems.map((x) => ({
        _id: x._id,
        expenseNumber: x.expenseNumber,
        employee: refPerson(x.employeeId),
        category: x.category,
        amount: x.amount,
        currency: x.currency,
        date: toDateKey(x.date),
        status: x.status,
        awaiting: x.currentApproverType,
      })),
    },
    date: today,
  };
};

/* ------------------------------ Employee ------------------------------ */

export const employeeDashboard = async (ctx: RequestContext) => {
  const org = ctx.organizationId;
  const today = todayKey(ctx.timezone);
  // Everything below is independent, so it all runs in parallel (each query is a round trip to the remote DB).
  const common = Promise.all([latestVisible(ctx, 5), NotificationModel.countDocuments({ organizationId: org, userId: ctx.userId, readAt: null })]);
  if (!ctx.employeeId) {
    const [announcements, unread] = await common;
    return { today: null, workedMinutes: 0, leaveBalances: [], upcomingHolidays: [], payslips: [], goals: [], announcements, unreadNotifications: unread, date: today };
  }
  const employeeId = ctx.employeeId;

  const [[announcements, unread], attendance, balances, holidays, payslips, goals] = await Promise.all([
    common,
    AttendanceModel.findOne({ organizationId: org, employeeId, date: dateOnly(today) })
      .select('date checkIn checkOut breaks status workMode workingMinutes breakMinutes overtimeMinutes isLate lateMinutes')
      .lean(),
    listBalances(org, employeeId, Number(today.slice(0, 4))),
    // Holidays depend on the employee's location: chain just that lookup.
    EmployeeModel.findOne({ _id: employeeId, organizationId: org })
      .select('locationId')
      .lean()
      .then((employee) => holidaysInRange(org, today, addDaysKey(today, 366), employee?.locationId ?? null)),
    PayslipModel.find({ organizationId: org, employeeId, status: { $in: ['FINAL', 'PAID'] } })
      .sort({ year: -1, month: -1 })
      .limit(3)
      .select('payrollId month year currency status grossEarnings totalDeductions netPay paymentDate')
      .lean(),
    GoalModel.find({ organizationId: org, employeeId, deletedAt: null, status: { $in: ['NOT_STARTED', 'IN_PROGRESS'] } })
      .sort({ dueDate: 1 })
      .limit(10)
      .select('title category status progress dueDate weight cycleId')
      .lean(),
  ]);

  let workedMinutes = 0;
  if (attendance?.checkIn) {
    const now = new Date();
    if (attendance.checkOut && attendance.workingMinutes) {
      workedMinutes = attendance.workingMinutes;
    } else {
      const end = attendance.checkOut ?? now;
      const breaks = (attendance.breaks ?? []).reduce((a, b) => a + minutesBetween(b.start, b.end ?? now), 0);
      workedMinutes = Math.max(0, minutesBetween(attendance.checkIn, end) - breaks);
    }
  }

  const upcomingHolidays = [...holidays.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 5)
    .map(([date, h]) => ({ date, name: h.name, type: h.type, optional: h.optional, inDays: dayDiff(today, date) }));

  return {
    today: attendance,
    workedMinutes,
    leaveBalances: balances.map((b) => ({
      _id: b._id,
      leaveType: b.leaveType,
      allocated: b.allocated,
      carryForward: b.carryForward,
      used: b.used,
      pending: b.pending,
      remaining: b.remaining,
    })),
    upcomingHolidays,
    payslips,
    goals,
    announcements,
    unreadNotifications: unread,
    date: today,
  };
};
