import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, Laptop, PackageCheck, Plus, Star, Trash2, Undo2, Wallet } from 'lucide-react';
import { ASSET_CONDITIONS, assetReturnSchema } from '@stencil/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { DatePicker, Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { apiDateKey, cn, formatDate } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import {
  useCreateOffCycleRun,
  useEmployeePayslips,
  usePayrollRuns,
  useReturnAsset,
  type AssetAssignment,
  type AssetReturnInput,
  type OffboardingDetail,
  type PayrollRun,
  type PayrollRunRef,
} from '../api';
import { monthLabel, todayKey } from './lifecycle-ui';

/* ------------------------------ Asset return ------------------------------ */

const ReturnAssetDialog = ({ assignment, offboardingId, onClose }: { assignment: AssetAssignment | null; offboardingId: string; onClose: () => void }) => {
  const ret = useReturnAsset(offboardingId);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AssetReturnInput>({ resolver: zodResolver(assetReturnSchema), defaultValues: { returnedDate: todayKey(), condition: 'GOOD', notes: '' } });
  const { register, handleSubmit, reset, setError, formState } = form;

  useEffect(() => {
    if (assignment) {
      reset({ returnedDate: todayKey(), condition: 'GOOD', notes: '' });
      setServerError(null);
    }
  }, [assignment, reset]);

  const asset = assignment?.assetId;
  const onSubmit = handleSubmit(async (values) => {
    if (!asset) return;
    setServerError(null);
    try {
      const res = await ret.mutateAsync({ assetId: asset._id, input: values });
      toast.success(res.message ?? `${asset.name} returned`);
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  return (
    <Modal
      open={!!assignment}
      onClose={onClose}
      title="Record asset return"
      description={asset ? `${asset.assetTag} · ${asset.name}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} icon={<Undo2 className="h-4 w-4" />}>
            Record return
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormGrid>
          <FormField label="Return date" required error={formState.errors.returnedDate}>
            {({ id, invalid }) => <DatePicker id={id} aria-invalid={invalid} min={apiDateKey(assignment?.assignedDate) || undefined} {...register('returnedDate')} />}
          </FormField>
          <FormField label="Condition" required error={formState.errors.condition} hint="Damaged assets are moved to repair.">
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={ASSET_CONDITIONS.map((c) => ({ value: c, label: label(c) }))} {...register('condition')} />}
          </FormField>
        </FormGrid>
        <FormField label="Notes" error={formState.errors.notes as { message?: string } | undefined}>
          {({ id }) => <Textarea id={id} rows={3} maxLength={500} {...register('notes')} />}
        </FormField>
      </form>
    </Modal>
  );
};

export const AssetReturnPanel = ({ o, active }: { o: OffboardingDetail; active: boolean }) => {
  const { can } = usePermissions();
  const canReturn = can('asset:return');
  const [returning, setReturning] = useState<AssetAssignment | null>(null);

  if (!o.assets.length) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
        <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>No assets are assigned to this employee{active ? ' — this step can be completed.' : '.'}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {active && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {o.assets.length} asset{o.assets.length === 1 ? '' : 's'} must be returned before moving to clearance.
        </div>
      )}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {o.assets.map((a) => (
          <li key={a._id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-muted">
                <Laptop className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{a.assetId ? a.assetId.name : 'Unknown asset'}</p>
                <p className="truncate text-xs text-muted">
                  {[a.assetId?.assetTag, a.assetId ? label(a.assetId.category) : null, a.assetId?.serialNumber ? `S/N ${a.assetId.serialNumber}` : null].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs text-muted">
                  Assigned {formatDate(a.assignedDate)}
                  {a.expectedReturnDate ? ` · expected back ${formatDate(a.expectedReturnDate)}` : ''}
                </p>
              </div>
            </div>
            {canReturn && a.assetId && (
              <Button variant="outline" size="sm" className="w-full sm:w-auto" icon={<Undo2 className="h-4 w-4" />} onClick={() => setReturning(a)}>
                Return
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!canReturn && <p className="text-xs text-muted">Asset returns are recorded by users with asset management access.</p>}
      <ReturnAssetDialog assignment={returning} offboardingId={o._id} onClose={() => setReturning(null)} />
    </div>
  );
};

/* -------------------------------- Clearance ------------------------------- */

export interface ClearanceDraft {
  department: string;
  cleared: boolean;
  note: string;
}

export const ClearancePanel = ({ items, onChange, editable }: { items: ClearanceDraft[]; onChange: (items: ClearanceDraft[]) => void; editable: boolean }) => {
  const [newDept, setNewDept] = useState('');
  const inputId = useId();
  const pending = items.filter((i) => !i.cleared).length;
  const update = (index: number, patch: Partial<ClearanceDraft>) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const add = () => {
    const name = newDept.trim();
    if (!name || items.some((i) => i.department.toLowerCase() === name.toLowerCase())) return;
    onChange([...items, { department: name, cleared: false, note: '' }]);
    setNewDept('');
  };

  return (
    <div className="space-y-3">
      <div
        role="status"
        className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          pending
            ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
            : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
        )}
      >
        {pending ? `${pending} department${pending === 1 ? '' : 's'} still to clear. Every department must be cleared to continue.` : 'All departments cleared.'}
        {editable && ' Changes are saved when you advance to the next step.'}
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {items.map((item, index) => (
          <li key={item.department} className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                {item.cleared ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-line-strong" aria-hidden />}
                <span className="truncate">{item.department}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted">{item.cleared ? 'Cleared' : 'Pending'}</span>
                <Switch checked={item.cleared} disabled={!editable} onChange={(v) => update(index, { cleared: v })} label={`${item.department} cleared`} />
                {editable && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.department}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </span>
            </div>
            {editable ? (
              <Input aria-label={`Note for ${item.department}`} placeholder="Note (optional)" maxLength={300} value={item.note} onChange={(e) => update(index, { note: e.target.value })} className="h-8" />
            ) : (
              item.note && <p className="text-xs text-muted">{item.note}</p>
            )}
          </li>
        ))}
        {!items.length && <li className="px-4 py-6 text-center text-sm text-muted">No departments on the clearance list.</li>}
      </ul>
      {editable && items.length < 20 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={inputId} className="sr-only">
            Add department
          </label>
          <Input
            id={inputId}
            placeholder="Add a department (e.g. Legal)"
            maxLength={60}
            value={newDept}
            onChange={(e) => setNewDept(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={add} disabled={!newDept.trim()}>
            Add
          </Button>
        </div>
      )}
    </div>
  );
};

/* ------------------------------ Final payroll ----------------------------- */

const CreateOffCycleDialog = ({
  open,
  employeeId,
  employeeName,
  defaultMonthKey,
  onClose,
}: {
  open: boolean;
  employeeId: string;
  employeeName: string;
  defaultMonthKey: string;
  onClose: (created?: PayrollRun) => void;
}) => {
  const create = useCreateOffCycleRun();
  const [month, setMonth] = useState(1);
  const [year, setYear] = useState(2000);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const [y, m] = defaultMonthKey.split('-').map(Number);
    setYear(y ?? new Date().getFullYear());
    setMonth(m ?? new Date().getMonth() + 1);
    setNotes(`Final settlement — ${employeeName}`);
    setError(null);
  }, [open, defaultMonthKey, employeeName]);

  const submit = async () => {
    setError(null);
    try {
      const res = await create.mutateAsync({ month, year, employeeIds: [employeeId], notes: notes.trim() || undefined });
      toast.success('Off-cycle payroll run created');
      onClose(res.data);
    } catch (err) {
      setError(toApiError(err).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title="Create off-cycle payroll run"
      description={`A draft run containing only ${employeeName}. Process and approve it from Payroll.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} icon={<Wallet className="h-4 w-4" />}>
            Create run
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={error} />
        <FormGrid>
          <FormField label="Month" required>
            {({ id }) => (
              <Select
                id={id}
                value={String(month)}
                onChange={(e) => setMonth(Number(e.target.value))}
                options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }) }))}
              />
            )}
          </FormField>
          <FormField label="Year" required>
            {({ id }) => <Input id={id} type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} />}
          </FormField>
        </FormGrid>
        <FormField label="Notes">{({ id }) => <Input id={id} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}</FormField>
      </div>
    </Modal>
  );
};

const runRef = (value: OffboardingDetail['finalPayrollId']): PayrollRunRef | null => (value && typeof value === 'object' ? value : null);

export const FinalPayrollPanel = ({ o, value, onChange, active }: { o: OffboardingDetail; value: string; onChange: (id: string) => void; active: boolean }) => {
  const { can } = usePermissions();
  const canRead = can('payroll:read');
  const canCreate = can('payroll:create');
  const employeeId = o.employeeId?._id;
  const runs = usePayrollRuns(canRead && active);
  const slips = useEmployeePayslips(employeeId, canRead && active);
  const [creating, setCreating] = useState(false);
  const current = runRef(o.finalPayrollId);
  const groupName = useId();

  const options = useMemo(() => {
    const withSlip = new Set((slips.data?.data ?? []).map((s) => String(s.payrollId)));
    return (runs.data?.data ?? [])
      .filter((r) => r.status !== 'CANCELLED')
      .map((run) => ({ run, includes: withSlip.has(run._id) || (!!run.isOffCycle && !!employeeId && (run.employeeIds ?? []).map(String).includes(employeeId)) }))
      .sort((a, b) => Number(b.includes) - Number(a.includes));
  }, [runs.data, slips.data, employeeId]);

  if (!active) {
    return current ? (
      <p className="text-sm text-fg-2">
        Final settlement run: <span className="font-medium text-fg">{monthLabel(current.month, current.year)}</span>
        {current.isOffCycle ? ' (off-cycle)' : ''} · <StatusBadge status={current.status} />
      </p>
    ) : (
      <p className="text-sm text-muted">No final settlement run recorded yet.</p>
    );
  }

  const choice = (id: string, content: ReactNode, key: string) => (
    <label
      key={key}
      className={cn(
        'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2',
        value === id && 'bg-brand-50/70 hover:bg-brand-50 dark:bg-brand-500/10 dark:hover:bg-brand-500/10',
      )}
    >
      <input type="radio" name={groupName} className="mt-1 h-4 w-4 accent-brand-600" checked={value === id} onChange={() => onChange(id)} />
      <span className="min-w-0 flex-1">{content}</span>
    </label>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Link the payroll run that settles this employee’s final pay. Without a selection, the latest approved or paid run containing their payslip is used.
      </p>
      {!canRead ? (
        <div className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-fg-2">
          You don’t have access to payroll runs. Advancing will use the latest approved or paid run that includes this employee.
        </div>
      ) : runs.isLoading || slips.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading payroll runs">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : runs.error ? (
        <ErrorState message={runs.error.message} onRetry={() => runs.refetch()} className="py-8" />
      ) : (
        <fieldset className="overflow-hidden rounded-lg border border-line">
          <legend className="sr-only">Final settlement payroll run</legend>
          <div className="divide-y divide-line">
            {choice(
              '',
              <>
                <span className="block text-sm font-medium text-fg">Automatic</span>
                <span className="block text-xs text-muted">Latest approved or paid run with a payslip for this employee</span>
              </>,
              'auto',
            )}
            {options.map(({ run, includes }) =>
              choice(
                run._id,
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                      {monthLabel(run.month, run.year)}
                      {run.isOffCycle && <Badge tone="purple">Off-cycle</Badge>}
                      <StatusBadge status={run.status} />
                    </span>
                    <span className={cn('mt-0.5 block text-xs', includes ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted')}>
                      {includes ? 'Includes this employee' : 'No payslip for this employee yet'}
                    </span>
                  </span>
                  <Link
                    to={`/payroll/${run._id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    Open <ExternalLink className="h-3 w-3" aria-hidden />
                  </Link>
                </span>,
                run._id,
              ),
            )}
            {!options.length && <EmptyState className="py-8" icon={<Wallet className="h-6 w-6" />} title="No payroll runs yet" description="Create an off-cycle run for the final settlement." />}
          </div>
        </fieldset>
      )}
      {canCreate && employeeId && (
        <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Create off-cycle run
        </Button>
      )}
      {employeeId && (
        <CreateOffCycleDialog
          open={creating}
          employeeId={employeeId}
          employeeName={o.employeeId ? `${o.employeeId.firstName} ${o.employeeId.lastName}` : 'employee'}
          defaultMonthKey={apiDateKey(o.lastWorkingDate) || todayKey()}
          onClose={(created) => {
            setCreating(false);
            if (created) onChange(created._id);
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------ Exit interview ---------------------------- */

export interface ExitInterviewDraft {
  reasonForLeaving: string;
  rating?: number;
  wouldRecommend?: boolean;
  feedback: string;
}

export const ExitInterviewPanel = ({ value, onChange, editable }: { value: ExitInterviewDraft; onChange: (v: ExitInterviewDraft) => void; editable: boolean }) => {
  const ratingLabel = useId();
  const recommendLabel = useId();
  const set = (patch: Partial<ExitInterviewDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <FormField label="Primary reason for leaving">
        {({ id }) => <Input id={id} maxLength={500} disabled={!editable} value={value.reasonForLeaving} onChange={(e) => set({ reasonForLeaving: e.target.value })} />}
      </FormField>
      <FormGrid>
        <div className="space-y-1.5">
          <p id={ratingLabel} className="text-sm font-medium text-fg">
            Overall experience
          </p>
          <div role="radiogroup" aria-labelledby={ratingLabel} className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value.rating === n}
                aria-label={`${n} out of 5`}
                disabled={!editable}
                onClick={() => set({ rating: value.rating === n ? undefined : n })}
                className="rounded-md p-1 transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Star className={cn('h-6 w-6', value.rating && n <= value.rating ? 'fill-amber-400 text-amber-400' : 'text-line-strong')} aria-hidden />
              </button>
            ))}
            <span className="ml-2 text-xs text-muted">{value.rating ? `${value.rating}/5` : 'Not rated'}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <p id={recommendLabel} className="text-sm font-medium text-fg">
            Would recommend us as an employer
          </p>
          <div role="radiogroup" aria-labelledby={recommendLabel} className="inline-flex rounded-lg border border-line-strong p-0.5">
            {[
              { v: true, l: 'Yes' },
              { v: false, l: 'No' },
            ].map((opt) => (
              <button
                key={opt.l}
                type="button"
                role="radio"
                aria-checked={value.wouldRecommend === opt.v}
                disabled={!editable}
                onClick={() => set({ wouldRecommend: value.wouldRecommend === opt.v ? undefined : opt.v })}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed',
                  value.wouldRecommend === opt.v ? 'bg-brand-600 text-white' : 'text-muted hover:text-fg',
                )}
              >
                {opt.l}
              </button>
            ))}
          </div>
        </div>
      </FormGrid>
      <FormField label="Feedback">
        {({ id }) => <Textarea id={id} rows={5} maxLength={5000} disabled={!editable} value={value.feedback} onChange={(e) => set({ feedback: e.target.value })} />}
      </FormField>
    </div>
  );
};
