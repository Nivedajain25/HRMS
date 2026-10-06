import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';

/* -------------------------------- Shared ------------------------------- */

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

/* ------------------------------- Employee ------------------------------ */

export interface DashboardAttendance {
  _id: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  breaks: { start: string; end?: string | null }[];
  status: string;
  workMode?: 'OFFICE' | 'REMOTE';
  workingMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  lateMinutes: number;
}

export interface DashboardLeaveBalance {
  _id: string;
  leaveType: { _id: string; name: string; code: string; color?: string; isWorkFromHome?: boolean; active?: boolean };
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

export interface DashboardGoal {
  _id: string;
  title: string;
  category: string;
  status: string;
  progress: number;
  dueDate?: string | null;
  weight?: number;
}

export interface EmployeeDashboard {
  today: DashboardAttendance | null;
  workedMinutes: number;
  leaveBalances: DashboardLeaveBalance[];
  upcomingHolidays: DashboardHoliday[];
  payslips: DashboardPayslip[];
  goals: DashboardGoal[];
  announcements: DashboardAnnouncement[];
  unreadNotifications: number;
  date: string;
}

/* ------------------------------- Manager ------------------------------- */

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

export interface ManagerPendingLeave {
  _id: string;
  employee: string | null;
  leaveType?: { _id: string; name: string; code: string; color?: string } | null;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  awaiting?: string | null;
}

export interface ManagerDashboard {
  teamSize: number;
  directReports: number;
  attendanceToday: DaySummary | null;
  pendingLeave: { count: number; items: ManagerPendingLeave[] };
  goals: { total: number; averageProgress: number; byStatus: Record<string, number> } | null;
  reviews: { count: number; items: { _id: string; employee: string | null; cycle: string | null; status: string }[] };
  pendingExpenses: {
    count: number;
    totals?: { currency: string; amount: number; count: number }[];
    items: {
      _id: string;
      expenseNumber: string;
      employee: string | null;
      category: string;
      amount: number;
      currency: string;
      date: string;
      status: string;
      awaiting?: string | null;
    }[];
  };
  date?: string;
}

/* -------------------------------- Admin -------------------------------- */

export interface PersonDate {
  _id: string;
  employeeId?: string;
  name: string;
  profilePhoto?: string | null;
  department?: string | null;
  /** `MM-DD` */
  date: string;
  nextDate: string;
  inDays: number;
  years?: number;
}

export interface PendingApprovalItem {
  type: 'leave' | 'expense' | 'regularization';
  id: string;
  employee: string | null;
  summary: string;
  awaiting?: string | null;
  submittedAt?: string | null;
  url: string;
}

export interface ActivityItem {
  _id: string;
  action: string;
  module: string;
  recordId?: string | null;
  recordLabel?: string | null;
  userName?: string | null;
  timestamp: string;
}

export interface AdminDashboard {
  cards: {
    totalEmployees: number;
    activeEmployees: number;
    newEmployees: number;
    presentToday: number;
    absentToday: number;
    onLeaveToday: number;
    lateToday: number;
    /** Present and not late. */
    onTimeToday: number;
    notCheckedInToday: number;
    pendingApprovals: { leave: number; regularization: number; expense: number; total: number };
    payroll: {
      month: number;
      year: number;
      status: string;
      totalNet: number;
      totalGross: number;
      employeeCount: number;
      currency: string;
    } | null;
    openJobs: number;
  };
  charts: {
    employeeGrowth: { month: string; headcount: number; joined: number; exited: number }[];
    attendanceTrend: { date: string; present: number; absent: number; late: number; onLeave: number }[];
    leaveTrend: {
      types: { code: string; name: string; color?: string }[];
      months: { month: string; byType: Record<string, number>; total: number }[];
    };
    departmentDistribution: { departmentId: string | null; name: string; count: number }[];
    employmentTypeDistribution: { type: string; count: number }[];
  };
  widgets: {
    upcomingBirthdays: PersonDate[];
    workAnniversaries: PersonDate[];
    expiringDocuments: { _id: string; title: string; category: string; expiryDate: string | null; employee: string | null }[];
    recentActivities: ActivityItem[];
    pendingApprovals: PendingApprovalItem[];
  };
  /** Extras for the HR and Head dashboards. */
  insights: {
    joinersThisMonth: MovementPerson[];
    exitsThisMonth: MovementPerson[];
    /** The five latest joiners, any month. */
    recentJoiners?: MovementPerson[];
    /** Employees on probation whose period ends within 30 days. */
    probationEndingSoon?: number;
    onboardingInProgress: number;
    offboardingInProgress: number;
    /** Candidates in active stages; null without recruitment access. */
    pipeline: number | null;
    /** Present ÷ (present + absent) records this month, %. */
    attendanceRateMonth: number | null;
    /** The payroll run before `cards.payroll`. */
    payrollPrevious: { month: number; year: number; totalNet: number; currency: string } | null;
  };
  date: string;
}

export interface MovementPerson {
  _id: string;
  name: string;
  profilePhoto: string | null;
  designation: string | null;
  department: string | null;
  /** Joining or exit date (YYYY-MM-DD). */
  date: string | null;
}

/* ------------------------------ Query keys ----------------------------- */

export const dashboardKeys = {
  all: ['dashboard'] as const,
  employee: ['dashboard', 'employee'] as const,
  manager: ['dashboard', 'manager'] as const,
  admin: ['dashboard', 'admin'] as const,
};

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
  at: string;
  employee: { _id: string; name: string; profilePhoto: string | null; designation: string | null };
  /** Verb phrase without the subject ("applied for Casual Leave"); the UI adds the name or "You". */
  title: string;
  detail?: string;
  link?: string;
}

/** Recent activity: everyone's for HR / Head (`all`), otherwise the caller's own (`me`). Refreshes every minute. */
export const useActivityFeed = (scope: 'all' | 'me', limit = 12) =>
  useQuery({
    queryKey: ['dashboard', 'activity', scope, limit],
    queryFn: () => get<ActivityItem[]>('/dashboard/activity', { scope, limit }),
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

export const useAdminDashboard = (enabled: boolean) =>
  // Refreshes every 30 s so new requests (leave, regularization, expenses) show up without a reload.
  useQuery({ queryKey: dashboardKeys.admin, queryFn: () => get<AdminDashboard>('/dashboard/admin'), enabled, staleTime: 30_000, refetchInterval: 30_000 });

/* ------------------------------- Mutations ----------------------------- */

export const useDashboardLeaveDecision = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      post(`/leaves/${id}/${action}`, action === 'approve' ? {} : { reason }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: dashboardKeys.all }), qc.invalidateQueries({ queryKey: ['leaves'] })]),
  });
};
