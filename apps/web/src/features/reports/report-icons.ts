import { Briefcase, CalendarCheck, CalendarDays, MapPin, Package, Receipt, Target, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { ReportType } from '@stencil/shared';

export const REPORT_ICONS: Record<ReportType, { icon: LucideIcon; tone: string }> = {
  employees: { icon: Users, tone: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  attendance: { icon: CalendarCheck, tone: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  attendance_log: { icon: MapPin, tone: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300' },
  leave: { icon: CalendarDays, tone: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  payroll: { icon: Wallet, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  expenses: { icon: Receipt, tone: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300' },
  recruitment: { icon: Briefcase, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  performance: { icon: Target, tone: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  assets: { icon: Package, tone: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300' },
};
