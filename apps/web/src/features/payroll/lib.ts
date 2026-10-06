import type { SalaryCalculationType } from '@stencil/shared';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

export const periodLabel = (month: number, year: number) => `${MONTHS[month - 1] ?? month} ${year}`;

export const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

/** Current year ± a few years for pickers. */
export const yearOptions = (back = 5, forward = 1) => {
  const now = new Date().getFullYear();
  const out: { value: string; label: string }[] = [];
  for (let y = now + forward; y >= now - back; y--) out.push({ value: String(y), label: String(y) });
  return out;
};

export const CALC_LABELS: Record<SalaryCalculationType, string> = {
  FIXED: 'Fixed amount',
  PERCENT_OF_BASIC: '% of basic',
  PERCENT_OF_GROSS: '% of gross',
  SLAB: 'Slab',
};

export const isPercent = (t: string | undefined) => !!t && t.startsWith('PERCENT');

/** Organization currency (salary structures and previews are in org currency). */
export const useOrgCurrency = () => useAuthStore((s) => s.user?.organization.currency ?? 'USD');

export const compactMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};

export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

export const PAYMENT_MODES = ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER'] as const;
export const ADJUSTMENT_CATEGORIES = ['BONUS', 'OVERTIME', 'ADVANCE', 'REIMBURSEMENT', 'OTHER'] as const;

export const formatDays = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
