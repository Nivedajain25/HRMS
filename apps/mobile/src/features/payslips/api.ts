import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInfiniteList } from '@/features/profile/kit/infinite';

/* Same shapes as the web `features/payroll/api.ts` (payslip part). */

export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
  category?: string;
}

export interface Payslip {
  _id: string;
  payrollId: string;
  employeeId: string;
  month: number;
  year: number;
  currency: string;
  status: string;
  employeeSnapshot: {
    employeeId?: string;
    name?: string;
    department?: string;
    designation?: string;
    workEmail?: string;
    location?: string;
    joiningDate?: string;
    bankName?: string;
    accountNumberMasked?: string;
  };
  payableDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  daysInPeriod?: number;
  workingDays?: number;
  notEmployedDays?: number;
  presentDays?: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  absentDays?: number;
  holidays?: number;
  weekOffs?: number;
  overtimeHours?: number;
  prorationFactor?: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions?: PayslipLine[];
  paymentDate?: string | null;
  paymentReference?: string | null;
  paymentMode?: string | null;
  payroll?: { _id: string; month: number; year: number; status: string; periodStart: string; periodEnd: string; isOffCycle?: boolean } | null;
}

export const payslipKeys = {
  all: ['payslips'] as const,
  list: (q: object) => ['payslips', 'list', q] as const,
  detail: (id: string) => ['payslips', 'detail', id] as const,
};

/** My FINAL / PAID payslips, newest first. */
export const useMyPayslips = (year: number | undefined) => {
  const { hasEmployee } = useAuth();
  // The server's default order is year ↓, month ↓.
  const query = { scope: 'me', year } as const;
  return useInfiniteList<Payslip>(payslipKeys.list(query), '/payslips', query, { enabled: hasEmployee, limit: 12 });
};

export const usePayslip = (id: string | undefined) =>
  useQuery({ queryKey: payslipKeys.detail(id ?? ''), queryFn: () => get<Payslip>(`/payslips/${id}`), enabled: !!id });

/** `payslip-2026-09.pdf` */
export const payslipFileName = (p: Pick<Payslip, 'month' | 'year'>) => `payslip-${p.year}-${String(p.month).padStart(2, '0')}.pdf`;

/** Day counts: `22`, `21.5`, `—`. */
export const formatDays = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
