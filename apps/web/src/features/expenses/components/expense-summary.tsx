import type { ReactNode } from 'react';
import { Banknote, CheckCircle2, FileEdit, Hourglass } from 'lucide-react';
import type { ExpenseStatus } from '@stencil/shared';
import { StatCard } from '@/components/ui/display';
import { formatMoney } from '@/lib/utils';
import type { ExpenseSummary } from '../api';

interface Group {
  key: string;
  label: string;
  statuses: ExpenseStatus[];
  icon: ReactNode;
  tone: 'amber' | 'green' | 'teal' | 'gray';
}

const GROUPS: Group[] = [
  { key: 'pending', label: 'Awaiting approval', statuses: ['SUBMITTED', 'PENDING_APPROVAL'], icon: <Hourglass className="h-5 w-5" />, tone: 'amber' },
  { key: 'approved', label: 'Approved · unpaid', statuses: ['APPROVED'], icon: <CheckCircle2 className="h-5 w-5" />, tone: 'green' },
  { key: 'paid', label: 'Reimbursed', statuses: ['PAID'], icon: <Banknote className="h-5 w-5" />, tone: 'teal' },
  { key: 'draft', label: 'Drafts', statuses: ['DRAFT'], icon: <FileEdit className="h-5 w-5" />, tone: 'gray' },
];

/** Totals per status group, per currency (the org currency is shown first). */
export const ExpenseSummaryCards = ({ summary, loading, currency }: { summary?: ExpenseSummary; loading: boolean; currency: string }) => (
  <div className="mb-6 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
    {GROUPS.map((g) => {
      const rows = (summary?.byStatus ?? []).filter((r) => g.statuses.includes(r.status));
      const byCurrency = new Map<string, { total: number; count: number }>();
      for (const r of rows) {
        const cur = byCurrency.get(r.currency) ?? { total: 0, count: 0 };
        cur.total += r.total;
        cur.count += r.count;
        byCurrency.set(r.currency, cur);
      }
      const primary = byCurrency.get(currency) ?? { total: 0, count: 0 };
      const others = [...byCurrency.entries()].filter(([c]) => c !== currency);
      const count = [...byCurrency.values()].reduce((n, v) => n + v.count, 0);
      const hint = [
        `${count} ${count === 1 ? 'claim' : 'claims'}`,
        ...others.map(([c, v]) => `+ ${formatMoney(v.total, c)}`),
      ].join(' · ');
      return (
        <StatCard
          key={g.key}
          label={g.label}
          value={<span className="text-xl sm:text-2xl">{formatMoney(primary.total, currency)}</span>}
          hint={summary ? hint : undefined}
          icon={g.icon}
          tone={g.tone}
          loading={loading}
        />
      );
    })}
  </div>
);
