import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ASSET_CATEGORIES, ASSET_CONDITIONS, assetSchema } from '@stencil/shared';
import { applyServerErrors, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toOptions, useAllOf } from '@/features/employees/api';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { apiDateKey } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useSaveAsset, type AssetDetail, type AssetInput, type AssetRecord } from '../api';

type Output = z.output<typeof assetSchema>;
const enumOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));
const optionalNumber = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v));

const toForm = (a?: AssetRecord | null): AssetInput => ({
  assetTag: a?.assetTag ?? undefined,
  name: a?.name ?? '',
  category: (a?.category as AssetInput['category']) ?? 'LAPTOP',
  brand: a?.brand ?? '',
  model: a?.model ?? '',
  serialNumber: a?.serialNumber ?? '',
  purchaseDate: apiDateKey(a?.purchaseDate),
  purchaseCost: a?.purchaseCost ?? undefined,
  warrantyExpiry: apiDateKey(a?.warrantyExpiry),
  vendor: a?.vendor ?? '',
  locationId: a?.locationId?._id ?? '',
  condition: (a?.condition as AssetInput['condition']) ?? 'NEW',
  notes: a?.notes ?? '',
});

export const AssetFormDrawer = ({ open, onClose, asset }: { open: boolean; onClose: (saved?: AssetDetail) => void; asset?: AssetRecord | null }) => {
  const editing = !!asset;
  const { user } = usePermissions();
  const currency = user?.organization.currency ?? 'USD';
  const save = useSaveAsset(asset?._id);
  const locations = useAllOf('locations');
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<AssetInput, unknown, Output>({ resolver: zodResolver(assetSchema), defaultValues: toForm(asset) });
  const { register, handleSubmit, reset, formState, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      reset(toForm(asset));
      setServerError(null);
    }
  }, [open, asset, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload: Record<string, unknown> = { ...values };
    if (!editing) {
      for (const [k, v] of Object.entries(payload)) if (v === '' || v === undefined || v === null) delete payload[k];
    } else {
      // Emptied text fields are sent as '' (cleared); dates/cost cannot be cleared through the API, so omit them.
      for (const k of ['purchaseDate', 'warrantyExpiry', 'purchaseCost', 'assetTag']) if (payload[k] === '' || payload[k] === undefined) delete payload[k];
      if (payload.locationId === undefined) payload.locationId = null;
    }
    try {
      const res = await save.mutateAsync(payload);
      toast.success(editing ? 'Asset updated' : `Asset ${res.data.assetTag} created`);
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, Object.keys(toForm())));
    }
  });

  const text = (name: keyof AssetInput, lbl: string, opts: { type?: string; required?: boolean; hint?: string; placeholder?: string; wide?: boolean } = {}) => (
    <FormField label={lbl} error={errors[name]} required={opts.required} hint={opts.hint} className={opts.wide ? 'sm:col-span-2' : undefined}>
      {({ id, invalid }) => <Input id={id} type={opts.type ?? 'text'} aria-invalid={invalid} placeholder={opts.placeholder} {...register(name)} />}
    </FormField>
  );

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? `Edit ${asset?.assetTag}` : 'Add asset'}
      description={editing ? asset?.name : 'New assets start as available in the inventory.'}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create asset'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Identification">
          <FormGrid>
            {text('name', 'Name', { required: true, placeholder: 'e.g. MacBook Pro 14"', wide: true })}
            <FormField label="Category" required error={errors.category}>
              {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={enumOptions(ASSET_CATEGORIES)} {...register('category')} />}
            </FormField>
            <FormField label="Asset tag" error={errors.assetTag} hint={editing ? undefined : 'Leave blank to auto-generate (AST-0001…)'}>
              {({ id, invalid }) => (
                <Input id={id} aria-invalid={invalid} className="font-mono uppercase" maxLength={24} {...register('assetTag', { setValueAs: (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : undefined) })} />
              )}
            </FormField>
            {text('brand', 'Brand')}
            {text('model', 'Model')}
            {text('serialNumber', 'Serial number')}
            <FormField label="Condition" error={errors.condition}>
              {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={enumOptions(ASSET_CONDITIONS)} {...register('condition')} />}
            </FormField>
          </FormGrid>
        </FormSection>
        <FormSection title="Purchase & location">
          <FormGrid>
            {text('purchaseDate', 'Purchase date', { type: 'date' })}
            <FormField label={`Purchase cost (${currency})`} error={errors.purchaseCost}>
              {({ id, invalid }) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" aria-invalid={invalid} {...register('purchaseCost', { setValueAs: optionalNumber })} />}
            </FormField>
            {text('warrantyExpiry', 'Warranty expiry', { type: 'date' })}
            {text('vendor', 'Vendor')}
            <FormField label="Location" error={errors.locationId}>
              {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={toOptions(locations.data)} placeholder="Not set" {...register('locationId')} />}
            </FormField>
          </FormGrid>
          <FormField label="Notes" error={errors.notes}>
            {({ id, invalid }) => <Textarea id={id} rows={3} maxLength={1000} aria-invalid={invalid} {...register('notes')} />}
          </FormField>
        </FormSection>
      </form>
    </Drawer>
  );
};
