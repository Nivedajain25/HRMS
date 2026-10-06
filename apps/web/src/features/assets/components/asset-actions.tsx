import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Archive, CheckCircle2, Pencil, Trash2, Undo2, UserPlus, Wrench } from 'lucide-react';
import { ASSET_CONDITIONS, ASSET_WORKFLOW, assetAssignSchema, assetReturnSchema, type AssetStatus } from '@stencil/shared';
import { Combobox, EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { PersonCell } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal, useConfirm, type DropdownItem } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { formatDate, fullName, toDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { loadAvailableAssets, useAssetStatus, useAssignAsset, useDeleteAsset, useReturnAsset, type AssetRecord } from '../api';
import { AssetFormDrawer } from './asset-form-drawer';

const conditionOptions = ASSET_CONDITIONS.map((c) => ({ value: c, label: label(c) }));
const today = () => toDateKey(new Date());

/* ------------------------------- Assign ------------------------------- */

type AssignValues = z.input<typeof assetAssignSchema>;

export const AssignAssetModal = ({
  open,
  onClose,
  asset,
  employee,
}: {
  open: boolean;
  onClose: () => void;
  asset?: AssetRecord | null;
  /** Fixed assignee (employee profile); an asset picker is shown instead. */
  employee?: { id: string; name: string } | null;
}) => {
  const assign = useAssignAsset();
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AssignValues, unknown, z.output<typeof assetAssignSchema>>({ resolver: zodResolver(assetAssignSchema) });
  const { register, control, handleSubmit, reset, formState, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!open) return;
    setAssetId(null);
    setAssetError(null);
    setServerError(null);
    reset({
      employeeId: employee?.id ?? '',
      assignedDate: today(),
      expectedReturnDate: '',
      condition: asset?.condition === 'DAMAGED' ? 'GOOD' : ((asset?.condition as AssignValues['condition']) ?? 'GOOD'),
      notes: '',
    });
  }, [open, asset, employee, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const id = asset?._id ?? assetId;
    if (!id) {
      setAssetError('Select an available asset');
      return;
    }
    try {
      const res = await assign.mutateAsync({ id, ...values });
      toast.success(`${res.data.assetTag} assigned to ${res.data.currentEmployeeId ? fullName(res.data.currentEmployeeId) : 'employee'}`);
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['employeeId', 'assignedDate', 'expectedReturnDate', 'condition', 'notes']));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={asset ? `Assign ${asset.assetTag}` : `Assign an asset to ${employee?.name ?? 'employee'}`}
      description={asset ? asset.name : 'Only available assets can be assigned.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting} icon={<UserPlus className="h-4 w-4" />}>
            Assign
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        {!asset && (
          <FormField label="Asset" required error={assetError ?? undefined}>
            {({ id, invalid }) => (
              <Combobox
                id={id}
                invalid={invalid}
                value={assetId}
                onChange={(v) => {
                  setAssetId(typeof v === 'string' ? v : null);
                  setAssetError(null);
                }}
                loadOptions={loadAvailableAssets}
                placeholder="Search tag, name or serial…"
              />
            )}
          </FormField>
        )}
        {!employee && (
          <FormField label="Employee" required error={errors.employeeId}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={field.value || null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} />}
              />
            )}
          </FormField>
        )}
        <FormGrid>
          <FormField label="Assigned on" required error={errors.assignedDate}>
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('assignedDate')} />}
          </FormField>
          <FormField label="Expected return" error={errors.expectedReturnDate} hint="Optional — for loaners and temporary kit.">
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('expectedReturnDate')} />}
          </FormField>
          <FormField label="Condition at handover" error={errors.condition}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={conditionOptions.filter((o) => o.value !== 'DAMAGED')} {...register('condition')} />}
          </FormField>
        </FormGrid>
        <FormField label="Notes" error={errors.notes}>
          {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={500} aria-invalid={invalid} placeholder="Accessories included, charger, bag…" {...register('notes')} />}
        </FormField>
      </form>
    </Modal>
  );
};

/* ------------------------------- Return ------------------------------- */

type ReturnValues = z.input<typeof assetReturnSchema>;

export const ReturnAssetModal = ({ asset, onClose }: { asset: AssetRecord | null; onClose: () => void }) => {
  const ret = useReturnAsset();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ReturnValues, unknown, z.output<typeof assetReturnSchema>>({ resolver: zodResolver(assetReturnSchema) });
  const { register, handleSubmit, reset, formState, setError, watch } = form;
  const errors = formState.errors;
  const condition = watch('condition');

  useEffect(() => {
    if (!asset) return;
    setServerError(null);
    reset({ returnedDate: today(), condition: (asset.condition as ReturnValues['condition']) ?? 'GOOD', notes: '' });
  }, [asset, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!asset) return;
    setServerError(null);
    try {
      const res = await ret.mutateAsync({ id: asset._id, ...values });
      toast.success(res.data.status === 'REPAIR' ? `${asset.assetTag} returned and sent to repair` : `${asset.assetTag} returned to inventory`);
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['returnedDate', 'condition', 'notes']));
    }
  });

  return (
    <Modal
      open={!!asset}
      onClose={onClose}
      title={`Return ${asset?.assetTag ?? 'asset'}`}
      description={asset?.name}
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
        {asset?.currentEmployeeId && (
          <div className="rounded-lg bg-surface-2 px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-muted">Returned by</p>
            <PersonCell name={fullName(asset.currentEmployeeId)} subtitle={asset.currentEmployeeId.employeeId} photo={asset.currentEmployeeId.profilePhoto} />
          </div>
        )}
        <FormGrid>
          <FormField label="Returned on" required error={errors.returnedDate}>
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} max={today()} {...register('returnedDate')} />}
          </FormField>
          <FormField label="Condition" required error={errors.condition}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={conditionOptions} {...register('condition')} />}
          </FormField>
        </FormGrid>
        {condition === 'DAMAGED' && (
          <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Damaged assets are moved to <strong>In repair</strong> instead of back to available stock.
          </p>
        )}
        <FormField label="Notes" error={errors.notes}>
          {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={500} aria-invalid={invalid} {...register('notes')} />}
        </FormField>
      </form>
    </Modal>
  );
};

/* ------------------------------- Status ------------------------------- */

type StatusTarget = 'AVAILABLE' | 'REPAIR' | 'RETIRED';
const STATUS_COPY: Record<StatusTarget, { title: string; message: string; action: string }> = {
  REPAIR: { title: 'Send to repair', message: 'The asset is taken out of available stock until it is marked available again.', action: 'Send to repair' },
  AVAILABLE: { title: 'Mark as available', message: 'The asset returns to available stock and can be assigned again.', action: 'Mark available' },
  RETIRED: {
    title: 'Retire asset',
    message: 'Retired assets can no longer be assigned or repaired. This cannot be undone.',
    action: 'Retire asset',
  },
};

export const AssetStatusModal = ({ asset, target, onClose }: { asset: AssetRecord | null; target: StatusTarget | null; onClose: () => void }) => {
  const change = useAssetStatus();
  const [notes, setNotes] = useState('');
  useEffect(() => setNotes(''), [asset, target]);
  const copy = target ? STATUS_COPY[target] : null;

  const submit = () => {
    if (!asset || !target) return;
    change.mutate(
      { id: asset._id, status: target, notes: notes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`${asset.assetTag}: ${label(target).toLowerCase()}`);
          onClose();
        },
        onError: (err) => toast.error(toApiError(err).message),
      },
    );
  };

  return (
    <Modal
      open={!!asset && !!target}
      onClose={onClose}
      title={`${copy?.title ?? ''} · ${asset?.assetTag ?? ''}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={target === 'RETIRED' ? 'danger' : 'primary'} loading={change.isPending} onClick={submit}>
            {copy?.action}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-2">{copy?.message}</p>
      <div className="mt-3">
        <label htmlFor="asset-status-notes" className="mb-1.5 block text-sm font-medium text-fg">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <Textarea id="asset-status-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={target === 'REPAIR' ? 'Fault description, vendor, ticket #…' : undefined} />
      </div>
    </Modal>
  );
};

/* ------------------------------- Hook -------------------------------- */

type Pending = { kind: 'edit' | 'assign' | 'return'; asset: AssetRecord } | { kind: 'status'; asset: AssetRecord; target: StatusTarget } | null;

/**
 * Workflow-aware actions for an asset (ASSET_WORKFLOW + permissions) with the
 * modals they open. Render `element` once in the page.
 */
export const useAssetActions = (opts: { onDeleted?: (asset: AssetRecord) => void } = {}) => {
  const { can } = usePermissions();
  const confirm = useConfirm();
  const remove = useDeleteAsset();
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const allowed = (a: AssetRecord) => {
    const s = a.status as AssetStatus;
    return {
      edit: can('asset:create'),
      assign: can('asset:assign') && ASSET_WORKFLOW.can(s, 'ASSIGNED'),
      return: can('asset:return') && s === 'ASSIGNED',
      repair: can('asset:return') && s === 'AVAILABLE' && ASSET_WORKFLOW.can(s, 'REPAIR'),
      available: can('asset:return') && s === 'REPAIR' && ASSET_WORKFLOW.can(s, 'AVAILABLE'),
      retire: can('asset:return') && s !== 'ASSIGNED' && ASSET_WORKFLOW.can(s, 'RETIRED'),
      delete: can('asset:create') && (s === 'AVAILABLE' || s === 'RETIRED'),
    };
  };

  const destroy = async (a: AssetRecord) => {
    const { confirmed } = await confirm({
      title: `Delete ${a.assetTag}?`,
      message: `${a.name} is removed from the inventory. Its assignment history is kept for audit purposes.`,
      confirmLabel: 'Delete asset',
    });
    if (!confirmed) return;
    remove.mutate(a._id, {
      onSuccess: () => {
        toast.success(`${a.assetTag} deleted`);
        opts.onDeleted?.(a);
      },
    });
  };

  const items = (a: AssetRecord): DropdownItem[] => {
    const ok = allowed(a);
    return [
      { label: 'Edit details', icon: <Pencil className="h-4 w-4" />, onSelect: () => setPending({ kind: 'edit', asset: a }), hidden: !ok.edit },
      { label: 'Assign', icon: <UserPlus className="h-4 w-4" />, onSelect: () => setPending({ kind: 'assign', asset: a }), hidden: !ok.assign },
      { label: 'Record return', icon: <Undo2 className="h-4 w-4" />, onSelect: () => setPending({ kind: 'return', asset: a }), hidden: !ok.return },
      { label: 'Send to repair', icon: <Wrench className="h-4 w-4" />, onSelect: () => setPending({ kind: 'status', asset: a, target: 'REPAIR' }), hidden: !ok.repair },
      { label: 'Mark available', icon: <CheckCircle2 className="h-4 w-4" />, onSelect: () => setPending({ kind: 'status', asset: a, target: 'AVAILABLE' }), hidden: !ok.available },
      { label: 'Retire', icon: <Archive className="h-4 w-4" />, onSelect: () => setPending({ kind: 'status', asset: a, target: 'RETIRED' }), hidden: !ok.retire },
      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => void destroy(a), hidden: !ok.delete },
    ];
  };

  const element: ReactNode = (
    <>
      <AssetFormDrawer open={pending?.kind === 'edit'} asset={pending?.kind === 'edit' ? pending.asset : null} onClose={close} />
      <AssignAssetModal open={pending?.kind === 'assign'} asset={pending?.kind === 'assign' ? pending.asset : null} onClose={close} />
      <ReturnAssetModal asset={pending?.kind === 'return' ? pending.asset : null} onClose={close} />
      <AssetStatusModal asset={pending?.kind === 'status' ? pending.asset : null} target={pending?.kind === 'status' ? pending.target : null} onClose={close} />
    </>
  );

  return { items, allowed, open: setPending, element, deleting: remove.isPending };
};

export const formatAssignmentPeriod = (a: { assignedDate: string; returnedDate?: string | null }) =>
  `${formatDate(a.assignedDate)} – ${a.returnedDate ? formatDate(a.returnedDate) : 'present'}`;
