import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import { BLOOD_GROUPS, EMPLOYMENT_STATUS, EMPLOYMENT_TYPES, GENDERS, employeeCreateSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, errorAt, FormError, FormField, FormGrid, FormSection } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { get, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { apiDateKey, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { toOptions, useAllOf, useSaveEmployee, type EmployeeDetail } from './api';

type FormValues = z.input<typeof employeeCreateSchema> & { changeReason?: string };
const enumOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));

interface IdentityField {
  key: string;
  label: string;
  enabled: boolean;
  required: boolean;
}

const toFormValues = (e?: EmployeeDetail): FormValues => ({
  firstName: e?.firstName ?? '',
  middleName: e?.middleName ?? '',
  lastName: e?.lastName ?? '',
  gender: (e?.gender as FormValues['gender']) ?? undefined,
  dateOfBirth: apiDateKey(e?.dateOfBirth),
  weddingAnniversary: apiDateKey(e?.weddingAnniversary ?? undefined),
  bloodGroup: (e?.bloodGroup as FormValues['bloodGroup']) ?? undefined,
  personalEmail: e?.personalEmail ?? '',
  workEmail: e?.workEmail ?? '',
  phone: e?.phone ?? '',
  alternatePhone: e?.alternatePhone ?? '',
  address: e?.address ?? '',
  city: e?.city ?? '',
  state: e?.state ?? '',
  country: e?.country ?? '',
  postalCode: e?.postalCode ?? '',
  joiningDate: apiDateKey(e?.joiningDate) || new Date().toISOString().slice(0, 10),
  confirmationDate: apiDateKey(e?.confirmationDate),
  departmentId: e?.departmentId?._id ?? '',
  designationId: e?.designationId?._id ?? '',
  managerId: e?.managerId?._id ?? '',
  locationId: e?.locationId?._id ?? '',
  shiftId: e?.shiftId?._id ?? '',
  employmentType: (e?.employmentType as FormValues['employmentType']) ?? 'FULL_TIME',
  employmentStatus: (e?.employmentStatus as FormValues['employmentStatus']) ?? 'ACTIVE',
  probationPeriodDays: e?.probationPeriodDays ?? 90,
  noticePeriodDays: e?.noticePeriodDays ?? 30,
  emergencyContact: {
    contactName: e?.emergencyContact?.contactName ?? '',
    relationship: e?.emergencyContact?.relationship ?? '',
    phone: e?.emergencyContact?.phone ?? '',
    address: e?.emergencyContact?.address ?? '',
  },
  createUserAccount: true,
});

/** Removes empty strings so optional fields are omitted, and nulls clearable refs on edit. */
const clean = (values: FormValues, editing: boolean) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === undefined) {
      if (editing && ['departmentId', 'designationId', 'managerId', 'locationId', 'shiftId', 'confirmationDate'].includes(k)) out[k] = null;
      continue;
    }
    out[k] = v;
  }
  return out;
};

export const EmployeeFormDrawer = ({ open, onClose, employee }: { open: boolean; onClose: (saved?: EmployeeDetail) => void; employee?: EmployeeDetail }) => {
  const editing = !!employee;
  const { can } = usePermissions();
  const canSensitive = can('employee:read_sensitive');
  const save = useSaveEmployee(employee?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const departments = useAllOf('departments');
  const designations = useAllOf('designations');
  const locations = useAllOf('locations');
  const shifts = useAllOf('shifts');
  const settings = useQuery({ queryKey: ['organization', 'settings'], queryFn: () => get<{ identityFields: IdentityField[] }>('/organization/settings'), enabled: open && canSensitive });
  const identityFields = (settings.data?.identityFields ?? []).filter((f) => f.enabled);

  const form = useForm<FormValues>({ resolver: zodResolver(employeeCreateSchema), defaultValues: toFormValues(employee) });
  const { register, handleSubmit, control, formState, reset, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      reset(toFormValues(employee));
      setServerError(null);
    }
  }, [open, employee, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const payload = clean(values, editing);
    if (editing) {
      delete payload.createUserAccount;
      delete payload.employeeId;
    }
    // Only send sensitive sections when the user entered something.
    const bank = values.bank && Object.values(values.bank).some(Boolean) ? values.bank : undefined;
    const identity = values.identity && Object.values(values.identity).some(Boolean) ? values.identity : undefined;
    if (bank) payload.bank = Object.fromEntries(Object.entries(bank).filter(([, v]) => v));
    else delete payload.bank;
    if (identity) payload.identity = Object.fromEntries(Object.entries(identity).filter(([, v]) => v));
    else delete payload.identity;
    try {
      const res = await save.mutateAsync(payload as never);
      toast.success(res.message ?? (editing ? 'Employee updated' : 'Employee created'));
      onClose(res.data);
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  const text = (name: keyof FormValues | string, lbl: string, opts: { type?: string; required?: boolean; hint?: string } = {}) => (
    <FormField label={lbl} error={errorAt(errors, name)} required={opts.required} hint={opts.hint}>
      {({ id, invalid }) => <Input id={id} type={opts.type ?? 'text'} aria-invalid={invalid} {...register(name as keyof FormValues)} />}
    </FormField>
  );
  const select = (name: keyof FormValues, lbl: string, options: { value: string; label: string }[], placeholder?: string) => (
    <FormField label={lbl} error={errorAt(errors, name)}>
      {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={options} placeholder={placeholder} {...register(name)} />}
    </FormField>
  );

  return (
    <Drawer
      open={open}
      onClose={() => onClose()}
      title={editing ? `Edit ${fullName(employee)}` : 'Add employee'}
      description={editing ? `Employee ID ${employee?.employeeId}` : 'Creates the employee record, leave balances and onboarding checklist.'}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {editing ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-8">
        <FormError error={serverError} />
        <FormSection title="Identity">
          <FormGrid cols={3}>
            {text('firstName', 'First name', { required: true })}
            {text('middleName', 'Middle name')}
            {text('lastName', 'Last name')}
            {select('gender', 'Gender', enumOptions(GENDERS), 'Select…')}
            {text('dateOfBirth', 'Date of birth', { type: 'date' })}
            {text('weddingAnniversary', 'Wedding anniversary', { type: 'date' })}
            {select('bloodGroup', 'Blood group', enumOptions(BLOOD_GROUPS), 'Select…')}
          </FormGrid>
          {!editing && (
            <FormGrid cols={3}>{text('employeeId', 'Employee ID', { hint: 'Leave blank to auto-generate' })}</FormGrid>
          )}
        </FormSection>

        <FormSection title="Contact">
          <FormGrid>
            {text('workEmail', 'Work email', { type: 'email', required: true })}
            {text('personalEmail', 'Personal email', { type: 'email' })}
            {text('phone', 'Phone', { type: 'tel' })}
            {text('alternatePhone', 'Alternate phone', { type: 'tel' })}
          </FormGrid>
          <FormField label="Address" error={errors.address}>
            {({ id }) => <Textarea id={id} rows={2} {...register('address')} />}
          </FormField>
          <FormGrid cols={3}>
            {text('city', 'City')}
            {text('state', 'State / Region')}
            {text('country', 'Country')}
            {text('postalCode', 'Postal code')}
          </FormGrid>
        </FormSection>

        <FormSection title="Employment">
          <FormGrid>
            {text('joiningDate', 'Joining date', { type: 'date', required: true })}
            {text('confirmationDate', 'Confirmation date', { type: 'date' })}
            {select('departmentId', 'Department', toOptions(departments.data), 'None')}
            {select('designationId', 'Designation', toOptions(designations.data), 'None')}
            <FormField label="Reporting manager" error={errors.managerId}>
              {({ id }) => (
                <Controller
                  control={control}
                  name="managerId"
                  render={({ field }) => (
                    <EmployeePicker
                      id={id}
                      value={(field.value as string | null | undefined) ?? null}
                      onChange={(v) => field.onChange(v ?? '')}
                      selectedLabels={employee?.managerId ? { [employee.managerId._id]: fullName(employee.managerId) } : undefined}
                    />
                  )}
                />
              )}
            </FormField>
            {select('locationId', 'Location', toOptions(locations.data), 'None')}
            {select('shiftId', 'Shift', toOptions(shifts.data), 'Default shift')}
            {select('employmentType', 'Employment type', enumOptions(EMPLOYMENT_TYPES))}
            {select('employmentStatus', 'Status', enumOptions(EMPLOYMENT_STATUS.filter((s) => s !== 'EXITED' && s !== 'ARCHIVED')))}
            {text('probationPeriodDays', 'Probation (days)', { type: 'number' })}
            {text('noticePeriodDays', 'Notice period (days)', { type: 'number' })}
          </FormGrid>
          {editing && (
            <FormField label="Reason for change" hint="Recorded in the employment history for department, designation, manager, location, shift and status changes.">
              {({ id }) => <Input id={id} {...register('changeReason')} />}
            </FormField>
          )}
        </FormSection>

        <FormSection title="Emergency contact">
          <FormGrid>
            {text('emergencyContact.contactName', 'Name')}
            {text('emergencyContact.relationship', 'Relationship')}
            {text('emergencyContact.phone', 'Phone', { type: 'tel' })}
            {text('emergencyContact.address', 'Address')}
          </FormGrid>
        </FormSection>

        {canSensitive && (
          <FormSection title="Bank details" description={editing ? 'Leave the account number blank to keep the current one. Stored encrypted.' : 'Stored encrypted.'}>
            <FormGrid>
              {text('bank.bankName', 'Bank name')}
              {text('bank.accountHolderName', 'Account holder')}
              {text('bank.accountNumber', 'Account number', { hint: employee?.bank?.accountNumberMasked ? `Current: ${employee.bank.accountNumberMasked}` : undefined })}
              {text('bank.ifsc', 'IFSC / Routing code')}
              {text('bank.branch', 'Branch')}
            </FormGrid>
          </FormSection>
        )}

        {canSensitive && identityFields.length > 0 && (
          <FormSection title="Identity documents" description="Numbers are encrypted and masked for users without access to sensitive data.">
            <FormGrid>{identityFields.map((f) => text(`identity.${f.key}`, f.label, { hint: employee?.identity?.[f.key] ? `Current: ${employee.identity[f.key]}` : undefined }))}</FormGrid>
          </FormSection>
        )}

        {!editing && (
          <FormSection title="Access">
            <Checkbox label="Create a user account and email an invitation" description="The employee sets their own password from the invite link." {...register('createUserAccount')} />
          </FormSection>
        )}
      </form>
    </Drawer>
  );
};
