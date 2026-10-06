import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { HOLIDAY_TYPES, holidaySchema } from '@stencil/shared';
import { Combobox } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { useAllOf } from '@/features/employees/api';
import { useSaveHoliday, type HolidayOccurrence } from '../api';

type Values = z.input<typeof holidaySchema>;
const FIELDS = ['name', 'date', 'type', 'description', 'locationIds', 'recurring'];

export const HolidayFormDrawer = ({ open, holiday, defaultDate, onClose }: { open: boolean; holiday?: HolidayOccurrence | null; defaultDate?: string; onClose: () => void }) => {
  const editing = !!holiday;
  const save = useSaveHoliday(holiday?._id);
  const locations = useAllOf<{ _id: string; name: string; city?: string }>('locations');
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(holidaySchema) });
  const { register, handleSubmit, reset, formState, setError, control } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    reset({
      name: holiday?.name ?? '',
      date: holiday ? holiday.originalDate : (defaultDate ?? ''),
      type: (holiday?.type as Values['type']) ?? 'PUBLIC',
      description: holiday?.description ?? '',
      locationIds: holiday?.locationIds.map((l) => l._id) ?? [],
      recurring: holiday?.recurring ?? false,
    });
  }, [open, holiday, defaultDate, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await save.mutateAsync(holidaySchema.parse(values));
      toast.success(res.message ?? (editing ? 'Holiday updated' : 'Holiday created'));
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, FIELDS));
    }
  });

  const locationOptions = (locations.data ?? []).map((l) => ({ value: l._id, label: l.city ? `${l.name} (${l.city})` : l.name }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${holiday?.name}` : 'New holiday'}
      description={editing && holiday?.recurring ? 'Changes apply to every year this holiday repeats.' : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create holiday'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        <FormField label="Name" required error={errors.name}>
          {({ id, invalid }) => <Input id={id} aria-invalid={invalid} placeholder="e.g. Independence Day" {...register('name')} />}
        </FormField>
        <FormGrid>
          <FormField label="Date" required error={errors.date} hint={editing && holiday?.recurring ? `First observed ${holiday.originalDate}` : undefined}>
            {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('date')} />}
          </FormField>
          <FormField label="Type" error={errors.type}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={HOLIDAY_TYPES.map((t) => ({ value: t, label: label(t) }))} {...register('type')} />}
          </FormField>
        </FormGrid>
        <FormField label="Locations" error={errors.locationIds as { message?: string } | undefined} hint="Leave empty to apply to every location.">
          {({ id, invalid }) => (
            <Controller
              control={control}
              name="locationIds"
              render={({ field }) => (
                <Combobox id={id} multiple invalid={invalid} options={locationOptions} value={field.value ?? []} onChange={(v) => field.onChange(Array.isArray(v) ? v : [])} placeholder="All locations" />
              )}
            />
          )}
        </FormField>
        <FormField label="Description" error={errors.description}>
          {({ id, invalid }) => <Textarea id={id} rows={3} maxLength={500} aria-invalid={invalid} {...register('description')} />}
        </FormField>
        <Checkbox label="Repeats every year" description="Observed on the same day and month each year." {...register('recurring')} />
      </form>
    </Drawer>
  );
};
