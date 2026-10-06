import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame, CHART_COLORS, chartAxis, chartGrid, chartLegend, chartTooltip } from '@/components/charts/chart-kit';
import { Card, CardBody, CardHeader } from '@/components/ui/display';
import { formatMoney } from '@/lib/utils';
import { usePayrollSummary } from '../api';
import { compactMoney, MONTHS, MONTHS_SHORT } from '../lib';

export const PayrollSummaryChart = ({ year }: { year: number }) => {
  const summary = usePayrollSummary(year);
  const currency = summary.data?.currency ?? 'USD';
  const data = (summary.data?.months ?? []).map((m) => ({
    name: MONTHS_SHORT[m.month - 1],
    full: MONTHS[m.month - 1],
    net: m.totalNet,
    deductions: m.totalDeductions,
    employer: m.totalEmployerContributions,
  }));
  const empty = !!summary.data && summary.data.months.every((m) => m.runs === 0);
  const totals = summary.data?.totals;

  return (
    <Card className="mb-6">
      <CardHeader
        title={`Payroll cost ${year}`}
        description="Net pay, deductions and employer contributions per month (excluding cancelled runs)."
        actions={
          totals && !empty ? (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-right">
              <div>
                <dt className="text-xs text-muted">Net paid</dt>
                <dd className="text-sm font-semibold text-fg tabular-nums">{formatMoney(totals.totalNet, currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Total cost</dt>
                <dd className="text-sm font-semibold text-fg tabular-nums">{formatMoney(totals.totalCost, currency)}</dd>
              </div>
            </dl>
          ) : undefined
        }
      />
      <CardBody>
        <ChartFrame
          height={240}
          loading={summary.isLoading}
          error={summary.error}
          onRetry={() => summary.refetch()}
          empty={empty}
          emptyTitle={`No payroll runs in ${year}`}
          label={`Monthly payroll cost for ${year}, stacked by net pay, deductions and employer contributions`}
        >
          <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="name" {...chartAxis} />
            <YAxis {...chartAxis} width={64} tickFormatter={(v: number) => compactMoney(v, currency)} />
            <Tooltip
              {...chartTooltip}
              labelFormatter={(_l, payload) => (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ''}
              formatter={(value: number, name: string) => [formatMoney(value, currency), name]}
            />
            <Legend {...chartLegend} />
            <Bar dataKey="net" name="Net pay" stackId="cost" fill={CHART_COLORS.brand} stroke="var(--surface)" strokeWidth={1} />
            <Bar dataKey="deductions" name="Deductions" stackId="cost" fill={CHART_COLORS.amber} stroke="var(--surface)" strokeWidth={1} />
            <Bar dataKey="employer" name="Employer contributions" stackId="cost" fill={CHART_COLORS.teal} stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartFrame>
        {!!summary.data?.otherCurrencies?.length && (
          <p className="mt-3 text-xs text-muted">
            Not included above (different currency):{' '}
            {summary.data.otherCurrencies.map((o) => `${o.runs} run${o.runs === 1 ? '' : 's'} · net ${formatMoney(o.totalNet, o.currency)}`).join('; ')}
          </p>
        )}
      </CardBody>
    </Card>
  );
};
