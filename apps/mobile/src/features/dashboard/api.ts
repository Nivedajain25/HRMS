import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

/* Same shapes as the web `features/dashboard/api.ts`. */

export interface DashboardAnnouncement {
  _id: string;
  title: string;
  excerpt: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  pinned: boolean;
  publishAt: string;
  expiresAt?: string | null;
  audience: string;
  read: boolean;
}

export interface DashboardLeaveBalance {
  _id: string;
  leaveType: { _id: string; name: string; code: string; color?: string; paid?: boolean; isWorkFromHome?: boolean; active?: boolean };
  allocated: number;
  carryForward: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface DashboardHoliday {
  date: string;
  name: string;
  type: string;
  optional?: boolean;
  inDays: number;
}

export interface DashboardPayslip {
  _id: string;
  month: number;
  year: number;
  currency: string;
  status: string;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  paymentDate?: string | null;
}

export interface EmployeeDashboard {
  workedMinutes: number;
  leaveBalances: DashboardLeaveBalance[];
  upcomingHolidays: DashboardHoliday[];
  payslips: DashboardPayslip[];
  /** Active goals (not started / in progress). */
  goals?: { _id: string; title: string; progress: number; status: string }[];
  announcements: DashboardAnnouncement[];
  unreadNotifications: number;
  date: string;
}

export interface DaySummary {
  date: string;
  present: number;
  late: number;
  workFromHome: number;
  absent: number;
  onLeave: number;
  notCheckedIn: number;
  isWorkingDay: boolean;
}

export interface ManagerDashboard {
  teamSize: number;
  directReports: number;
  attendanceToday: DaySummary | null;
  pendingLeave: { count: number };
  reviews: { count: number };
  pendingExpenses: { count: number };
}

/** Organization-wide numbers (`GET /dashboard/admin`, HR / super admin). Subset of the web shape. */
export interface AdminDashboard {
  cards: {
    totalEmployees: number;
    activeEmployees: number;
    newEmployees: number;
    presentToday: number;
    absentToday: number;
    onLeaveToday: number;
    lateToday: number;
    onTimeToday: number;
    notCheckedInToday: number;
    pendingApprovals: { leave: number; regularization: number; expense: number; total: number };
    openJobs: number;
  };
  charts: {
    departmentDistribution: { departmentId: string | null; name: string; count: number }[];
    employeeGrowth?: { month: string; headcount: number; joined: number; exited: number }[];
  };
  widgets: {
    /** `date` is MM-DD; `nextDate` the next occurrence (YYYY-MM-DD). */
    upcomingBirthdays: { _id: string; name: string; profilePhoto?: string | null; date: string; nextDate: string; inDays: number }[];
    workAnniversaries: { _id: string; name: string; profilePhoto?: string | null; date: string; nextDate: string; inDays: number; years?: number }[];
    expiringDocuments?: { _id: string }[];
  };
  insights?: {
    joinersThisMonth: MovementPerson[];
    /** The five latest joiners, any month. */
    recentJoiners?: MovementPerson[];
    /** Employees on probation whose period ends within 30 days. */
    probationEndingSoon?: number;
  };
}

export interface MovementPerson {
  _id: string;
  name: string;
  profilePhoto: string | null;
  designation: string | null;
  department: string | null;
  /** Joining date (YYYY-MM-DD). */
  date: string | null;
}

export type BoardColumn = 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'DONE' | 'AWAY';

export interface BoardCard {
  column: BoardColumn;
  employee: { _id: string; employeeId: string; firstName: string; lastName: string; profilePhoto: string | null; department: string | null; designation: string | null };
  checkIn: string | null;
  checkOut: string | null;
  isLate: boolean;
  lateMinutes: number;
  workMode: 'OFFICE' | 'REMOTE' | null;
  absent: boolean;
  awayReason: string | null;
}

/** Live attendance board (`GET /attendance/board`): every employee in scope by today's state. */
export interface AttendanceBoard {
  date: string;
  dayKind: string;
  columns: { key: BoardColumn; label: string; count: number }[];
  cards: BoardCard[];
}

/** Activity feed item; `scope=all` carries who did it. */
export interface ActivityItem {
  id: string;
  type: string;
  at: string;
  title: string;
  detail?: string;
  link?: string;
  employee?: { _id: string; name: string; profilePhoto: string | null; designation: string | null };
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  employee: ['dashboard', 'employee'] as const,
  manager: ['dashboard', 'manager'] as const,
  admin: ['dashboard', 'admin'] as const,
  board: ['dashboard', 'board'] as const,
  orgActivity: ['dashboard', 'activity', 'all'] as const,
  referrals: ['dashboard', 'referrals'] as const,
};

export const useAdminDashboard = (enabled: boolean) =>
  useQuery({ queryKey: dashboardKeys.admin, queryFn: () => get<AdminDashboard>('/dashboard/admin'), enabled, refetchInterval: 60_000 });

interface ReferralPerson {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

/** Candidates referred by employees (web dashboard "Referrals" card): totals, the latest few and the top referrer. */
export interface ReferralSummary {
  total: number;
  inProcess: number;
  hired: number;
  recent: {
    _id: string;
    firstName: string;
    lastName: string;
    stage: string;
    createdAt: string;
    jobId: { _id: string; code?: string; title: string } | null;
    referredBy: ReferralPerson | null;
  }[];
  topReferrer: (ReferralPerson & { count: number }) | null;
}

/** Needs `recruitment:read` (Super Admin, Admin, HR). Under the dashboard root, so pull-to-refresh updates it. */
export const useReferralSummary = (enabled: boolean) =>
  useQuery({ queryKey: dashboardKeys.referrals, queryFn: () => get<ReferralSummary>('/recruitment/referrals/summary'), enabled, refetchInterval: 120_000 });

/** Live board for today, or any `date` (YYYY-MM-DD), optionally one department. */
export const useAttendanceBoard = (enabled: boolean, opts: { date?: string; departmentId?: string | null } = {}) =>
  useQuery({
    queryKey: [...dashboardKeys.board, opts.date ?? 'today', opts.departmentId ?? 'all'],
    queryFn: () => get<AttendanceBoard>('/attendance/board', { date: opts.date, departmentId: opts.departmentId ?? undefined }),
    enabled,
    refetchInterval: 60_000,
  });

export const useOrgActivity = (enabled: boolean) =>
  useQuery({
    queryKey: dashboardKeys.orgActivity,
    queryFn: () => get<ActivityItem[]>('/dashboard/activity', { scope: 'all', limit: 8 }),
    enabled,
    refetchInterval: 60_000,
  });

export const useEmployeeDashboard = () =>
  useQuery({ queryKey: dashboardKeys.employee, queryFn: () => get<EmployeeDashboard>('/dashboard/employee'), refetchInterval: 60_000 });

export const useManagerDashboard = (enabled: boolean) =>
  useQuery({
    queryKey: dashboardKeys.manager,
    queryFn: () => get<ManagerDashboard>('/dashboard/manager'),
    enabled,
    refetchInterval: 120_000,
  });
