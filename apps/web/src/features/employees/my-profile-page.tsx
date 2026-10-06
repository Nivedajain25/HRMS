import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { BLOOD_GROUPS, selfProfileUpdateSchema } from '@stencil/shared';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { patch, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { useMyEmployee, type EmployeeDetail } from './api';
import { EmployeeProfileView, ProfileHeader } from './employee-profile-page';

type Values = z.input<typeof selfProfileUpdateSchema>;

const EditContactDrawer = ({ open, onClose, e }: { open: boolean; onClose: () => void; e: EmployeeDetail }) => {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(selfProfileUpdateSchema) });
  useEffect(() => {
    if (open)
      form.reset({
        personalEmail: e.personalEmail ?? '',
        phone: e.phone ?? '',
        alternatePhone: e.alternatePhone ?? '',
        address: e.address ?? '',
        city: e.city ?? '',
        state: e.state ?? '',
        country: e.country ?? '',
        postalCode: e.postalCode ?? '',
        bloodGroup: (e.bloodGroup as Values['bloodGroup']) ?? undefined,
        dateOfBirth: e.dateOfBirth ? e.dateOfBirth.slice(0, 10) : '',
        weddingAnniversary: e.weddingAnniversary ? e.weddingAnniversary.slice(0, 10) : '',
        emergencyContact: { contactName: e.emergencyContact?.contactName ?? '', relationship: e.emergencyContact?.relationship ?? '', phone: e.emergencyContact?.phone ?? '', address: e.emergencyContact?.address ?? '' },
      });
  }, [open, e, form]);
  const save = useMutation({ mutationFn: (v: Values) => patch('/employees/me', v), meta: { silent: true }, onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }) });
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await save.mutateAsync(values);
      toast.success('Profile updated');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), form.setError));
    }
  });
  const field = (name: string, lbl: string, type = 'text') => (
    <FormField label={lbl} error={errorAt(form.formState.errors, name)}>
      {({ id, invalid }) => <Input id={id} type={type} aria-invalid={invalid} {...form.register(name as keyof Values)} />}
    </FormField>
  );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit my details"
      description="Employment details are maintained by HR."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>Save</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Contact">
          <FormGrid>
            {field('personalEmail', 'Personal email', 'email')}
            {field('phone', 'Phone', 'tel')}
            {field('alternatePhone', 'Alternate phone', 'tel')}
            <FormField label="Blood group">
              {({ id }) => <Select id={id} placeholder="Select…" options={BLOOD_GROUPS.map((b) => ({ value: b, label: b }))} {...form.register('bloodGroup')} />}
            </FormField>
          </FormGrid>
          <FormField label="Address">{({ id }) => <Textarea id={id} rows={2} {...form.register('address')} />}</FormField>
          <FormGrid>
            {field('city', 'City')}
            {field('state', 'State / Region')}
            {field('country', 'Country')}
            {field('postalCode', 'Postal code')}
          </FormGrid>
        </FormSection>
        <FormSection title="Celebrations" description="On these days everyone gets a company announcement and notification wishing you.">
          <FormGrid>
            {field('dateOfBirth', 'Date of birth', 'date')}
            {field('weddingAnniversary', 'Wedding anniversary', 'date')}
          </FormGrid>
        </FormSection>
        <FormSection title="Emergency contact">
          <FormGrid>
            {field('emergencyContact.contactName', 'Name')}
            {field('emergencyContact.relationship', 'Relationship')}
            {field('emergencyContact.phone', 'Phone', 'tel')}
            {field('emergencyContact.address', 'Address')}
          </FormGrid>
        </FormSection>
      </form>
    </Drawer>
  );
};

export const MyProfilePage = () => {
  const me = useMyEmployee();
  const [editing, setEditing] = useState(false);

  if (me.isLoading) return <PageSkeleton />;
  if (me.error) return <ErrorState className="card" message={me.error.message} onRetry={() => me.refetch()} />;
  if (!me.data) return <EmptyState className="card" title="No employee profile" description="Your account is not linked to an employee record." />;
  const e = me.data;

  return (
    <>
      <ProfileHeader
        e={e}
        photoEditable
        actions={
          <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
            Edit details
          </Button>
        }
      />
      <EmployeeProfileView employee={e} self />
      <EditContactDrawer open={editing} onClose={() => setEditing(false)} e={e} />
      <span className="sr-only">{label(e.employmentStatus)}</span>
    </>
  );
};
