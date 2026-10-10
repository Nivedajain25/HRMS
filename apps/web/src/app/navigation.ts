import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  Banknote,
  BarChart3,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  CircleUserRound,
  ClipboardList,
  Clock,
  ClockAlert,
  CreditCard,
  FileText,
  Flag,
  Gift,
  GraduationCap,
  BookOpen,
  HandCoins,
  IdCard,
  Laptop,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Network,
  Megaphone,
  Package,
  Plane,
  Receipt,
  ReceiptText,
  Settings,
  Siren,
  Star,
  Target,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  UserSearch,
  Video,
  Wallet,
} from 'lucide-react';
import type { Permission } from '@stencil/shared';
import { BeachUmbrella } from '@/components/icons/beach-umbrella';
import { ClockUser } from '@/components/icons/clock-user';
import { MonitorRequest } from '@/components/icons/monitor-request';
import type { ModuleTone } from '@/lib/module-colors';

export interface NavAccess {
  /** Visible when the user has ANY of these permissions. */
  any?: Permission[];
  /** Visible to managers (users with direct reports or team:view). */
  manager?: boolean;
  /** Visible to anyone with an employee profile. */
  employee?: boolean;
  /** Visible to every signed-in user. */
  everyone?: boolean;
}

export interface NavLink extends NavAccess {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Icon colour when it differs from the group's (see lib/module-colors). */
  tone?: ModuleTone;
}

export interface NavGroup extends NavAccess {
  label: string;
  icon: LucideIcon;
  /** What the module is about, as a colour (lib/module-colors); children inherit it. */
  tone: ModuleTone;
  to?: string;
  children?: NavLink[];
}

export const NAVIGATION: NavGroup[] = [
  { label: 'Dashboard', icon: LayoutDashboard, tone: 'purple', to: '/', everyone: true },
  {
    label: 'People',
    icon: Users,
    tone: 'blue',
    // Everyone sees People for the Org Chart; the other items keep their own access.
    everyone: true,
    manager: true,
    employee: true,
    any: ['employee:read', 'department:manage', 'designation:manage', 'location:manage', 'onboarding:manage', 'offboarding:manage'],
    children: [
      { label: 'Employees', to: '/employees', icon: UserRound, manager: true, any: ['employee:read'] },
      { label: 'Org Chart', to: '/employees/org-chart', icon: Network, everyone: true },
      { label: 'Departments', to: '/departments', icon: Building2, any: ['employee:read', 'department:manage'] },
      { label: 'Designations', to: '/designations', icon: IdCard, any: ['employee:read', 'designation:manage'] },
      { label: 'Locations', to: '/locations', icon: MapPin, any: ['employee:read', 'location:manage'] },
      { label: 'Onboarding', to: '/onboarding', icon: UserPlus, manager: true, employee: true, any: ['onboarding:manage'] },
      // Offboarding hidden from the menu for now (the /offboarding page still exists).
    ],
  },
  {
    label: 'Attendance',
    icon: CalendarCheck,
    tone: 'blue',
    everyone: true,
    children: [
      { label: 'Attendance', to: '/attendance', icon: Clock, tone: 'green', everyone: true },
      { label: 'Shifts', to: '/shifts', icon: CalendarClock, any: ['shift:manage', 'attendance:read'] },
      { label: 'Regularization', to: '/regularization', icon: ClockAlert, tone: 'amber', everyone: true },
      { label: 'Holidays', to: '/holidays', icon: BeachUmbrella, everyone: true },
    ],
  },
  {
    label: 'Leave',
    icon: CalendarDays,
    tone: 'blue',
    everyone: true,
    children: [
      { label: 'Requests', to: '/leave', icon: MonitorRequest, everyone: true },
      { label: 'Leave Types', to: '/leave/types', icon: ClockUser, any: ['leave_type:manage'] },
      { label: 'Calendar', to: '/leave/calendar', icon: CalendarRange, everyone: true },
    ],
  },
  {
    label: 'Payroll',
    icon: Wallet,
    tone: 'teal',
    everyone: true,
    children: [
      { label: 'Salary', to: '/salary', icon: Banknote, any: ['salary:read'] },
      { label: 'Payroll', to: '/payroll', icon: Calculator, any: ['payroll:read'] },
      { label: 'Payslips', to: '/payslips', icon: ReceiptText, everyone: true },
      { label: 'Loans & Advances', to: '/loans', icon: HandCoins, everyone: true },
    ],
  },
  {
    label: 'Performance',
    icon: Target,
    tone: 'pink',
    everyone: true,
    children: [
      { label: 'Goals', to: '/performance/goals', icon: Flag, everyone: true },
      { label: 'Reviews', to: '/performance/reviews', icon: Star, everyone: true },
      { label: 'Learning', to: '/performance/learning', icon: BookOpen, everyone: true },
      { label: 'My Training', to: '/performance/training', icon: GraduationCap, everyone: true },
    ],
  },
  {
    label: 'Recruitment',
    icon: Briefcase,
    tone: 'blue',
    any: ['recruitment:read'],
    manager: true,
    children: [
      { label: 'Jobs', to: '/recruitment/jobs', icon: BriefcaseBusiness, any: ['recruitment:read'] },
      { label: 'Candidates', to: '/recruitment/candidates', icon: UserSearch, any: ['recruitment:read'] },
      { label: 'Interviews', to: '/recruitment/interviews', icon: Video, any: ['recruitment:read'], manager: true },
    ],
  },
  {
    label: 'Expenses',
    icon: Receipt,
    tone: 'orange',
    everyone: true,
    children: [
      { label: 'Expenses', to: '/expenses', icon: CreditCard, everyone: true },
      { label: 'Travel Claims', to: '/travel-claims', icon: Plane, tone: 'orange', everyone: true },
      { label: 'Approvals', to: '/expenses/approvals', icon: CheckCheck, tone: 'amber', any: ['expense:approve', 'expense:pay'] },
    ],
  },
  {
    label: 'Assets',
    icon: Package,
    tone: 'gray',
    everyone: true,
    children: [
      { label: 'Assets', to: '/assets', icon: Laptop, everyone: true },
      { label: 'Asset Allocation', to: '/assets/assignments', icon: ArrowRightLeft, any: ['asset:read'] },
    ],
  },
  { label: 'Documents', icon: FileText, tone: 'gray', to: '/documents', everyone: true },
  // Everyone: anyone can assign a task to anyone.
  { label: 'Tasks', icon: ClipboardList, tone: 'gray', to: '/tasks', everyone: true },
  { label: 'Announcements', icon: Megaphone, tone: 'purple', to: '/announcements', everyone: true },
  { label: 'Emergencies', icon: Siren, tone: 'red', to: '/emergencies', employee: true, any: ['emergency:manage'] },
  // Same access as the sales figures (GET /sales/monthly).
  { label: 'Sales', icon: TrendingUp, tone: 'indigo', to: '/sales', employee: true, any: ['report:read', 'employee:read'] },
  { label: 'Incentives', icon: Gift, tone: 'teal', to: '/incentives', everyone: true },
  { label: 'Reports', icon: BarChart3, tone: 'purple', to: '/reports', any: ['report:read'] },
  { label: 'Settings', icon: Settings, tone: 'purple', to: '/settings', everyone: true },
  { label: 'My Account', icon: CircleUserRound, tone: 'blue', to: '/account', everyone: true },
  { label: 'Help', icon: LifeBuoy, tone: 'gray', to: '/help', everyone: true },
];

export const isAllowed = (item: NavAccess, perms: string[], isManager: boolean, hasEmployee = false) =>
  !!item.everyone ||
  (!!item.manager && isManager) ||
  (!!item.employee && hasEmployee) ||
  (!!item.any && item.any.some((p) => perms.includes(p)));
