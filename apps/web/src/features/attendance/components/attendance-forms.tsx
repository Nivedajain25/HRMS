import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { ATTENDANCE_STATUS, WORK_MODES, attendanceCreateSchema, timeString } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { StatusBadge } from '@/components/common/status-badge';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Badge, DescriptionList, PersonCell } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Drawer, Modal } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { fullName, minutesToHours, shiftRange } from '@/lib/utils';
import { useCreateAttendance, useUpdateAttendance, type AttendanceRow } from '../api';
import { addDaysToKey, dateKeyIn, formatDateTimeIn, formatKey, timeValueIn, useOrgTimezone, zonedToIso } from '../lib';
import { CaptureDetails } from './attendance-capture';

const statusOptions = ATTENDANCE_STATUS.map((s) => ({ value: s, label: label(s) }));
const modeOptions = WORK_MODES.map((m) => ({ value: m, label: label(m) }));
const optionalTime = z.union([z.literal(''), timeString]);

/* ------------------------------ Edit record ----------------------------- */

const editSchema = z
  .object({
    checkIn: optionalTime,
    checkOut: optionalTime,
    status: z.union([z.literal(''), z.enum(ATTENDANCE_STATUS)]),
    workMode: z.enum(WORK_MODES),
    note: z.string().trim().max(300),
  })
  .refine((v) => !v.checkOut || !!v.checkIn, { message: 'Check-in is required with check-out', path: ['checkIn'] })
  .refine((v) => !!v.checkIn || !!v.status, { message: 'Choose a status when there is no check-in', path: ['status'] });
type EditValues = z.infer<typeof editSchema>;

/** Admin editor for a single attendance record (times are in the organization timezone). */
export const AttendanceDrawer = ({ record, onClose, canEdit }: { record: AttendanceRow | null; onClose: () => void; canEdit: boolean }) => {
  const timeZone = useOrgTimezone();
  const update = useUpdateAttendance(record?._id);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<EditValues>({ resolver: zodResolver(editSchema) });
  const { register, handleSubmit, reset, formState, setError } = form;
  const errors = formState.errors;
  const dateKey = record?.date.slice(0, 10) ?? '';

  useEffect(() => {
    if (!record) return;
    setServerError(null);
    reset({
      checkIn: timeValueIn(record.checkIn, timeZone),
      checkOut: timeValueIn(record.checkOut, timeZone),
      status: '',
      workMode: record.workMode,
      note: record.note ?? '',
    });
  }, [record, reset, timeZone]);

  const onSubmit = handleSubmit(async (v) => {
    if (!record) return;
    setServerError(null);
    const checkIn = v.checkIn ? zonedToIso(dateKey, v.checkIn, timeZone) : null;
    const checkOut = v.checkOut ? zonedToIso(v.checkIn && v.checkOut <= v.checkIn ? addDaysToKey(dateKey, 1) : dateKey, v.checkOut, timeZone) : null;
    try {
      const res = await update.mutateAsync({
        checkIn,
        checkOut,
        workMode: v.workMode,
        note: v.note,
        ...(v.status ? { status: v.status } : {}),
      });
      toast.success(res.message ?? 'Attendance updated');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['checkIn', 'checkOut', 'status', 'workMode', 'note']));
    }
  });

  const e = record?.employeeId;
  return (
    <Drawer
      open={!!record}
      onClose={onClose}
      title={canEdit ? 'Edit attendance' : 'Attendance record'}
      description={record ? `${fullName(e)} · ${formatKey(dateKey, 'EEE, dd MMM yyyy')}` : undefined}
      footer={
        canEdit ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSubmit} loading={formState.isSubmitting}>
              Save changes
            </Button>
          </>
        ) : undefined
      }
    >
      {record && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <PersonCell name={fullName(e)} subtitle={[e?.employeeId, e?.departmentId?.name].filter(Boolean).join(' · ')} photo={e?.profilePhoto} to={e ? `/employees/${e._id}` : undefined} />
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={record.status} />
              {record.isLate && <Badge tone="amber">Late {minutesToHours(record.lateMinutes)}</Badge>}
              {record.regularized && <Badge tone="purple">Regularized</Badge>}
            </div>
          </div>
          <DescriptionList
            items={[
              { label: 'Check in', value: formatDateTimeIn(record.checkIn, timeZone) },
              { label: 'Check out', value: formatDateTimeIn(record.checkOut, timeZone) },
              { label: 'Worked', value: minutesToHours(record.workingMinutes) },
              { label: 'Break', value: minutesToHours(record.breakMinutes) },
              { label: 'Overtime', value: minutesToHours(record.overtimeMinutes) },
              { label: 'Early departure', value: record.isEarlyDeparture ? minutesToHours(record.earlyDepartureMinutes) : '—' },
              { label: 'Shift', value: record.shiftId ? `${record.shiftId.name} (${shiftRange(record.shiftId.startTime, record.shiftId.endTime)})` : '—' },
              { label: 'Source', value: label(record.source) },
            ]}
          />
          <CaptureDetails record={record} timeZone={timeZone} />
          {canEdit && (
            <form onSubmit={onSubmit} noValidate className="space-y-4 border-t border-line pt-5">
              <FormError error={serverError} />
              <p className="text-xs text-muted">Times are in {timeZone}. A check-out earlier than check-in is treated as the next day. Metrics are recalculated and the change is audited.</p>
              <FormGrid>
                <FormField label="Check-in" error={errors.checkIn}>
                  {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('checkIn')} />}
                </FormField>
                <FormField label="Check-out" error={errors.checkOut}>
                  {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('checkOut')} />}
                </FormField>
                <FormField label="Status" error={errors.status} hint="Leave on automatic to compute it from the times.">
                  {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={statusOptions} placeholder="Automatic" {...register('status')} />}
                </FormField>
                <FormField label="Work mode" error={errors.workMode}>
                  {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={modeOptions} {...register('workMode')} />}
                </FormField>
              </FormGrid>
              <FormField label="Note" error={errors.note}>
                {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={300} aria-invalid={invalid} {...register('note')} />}
              </FormField>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
};

/* ---------------------------- Mark attendance --------------------------- */

type MarkValues = z.input<typeof attendanceCreateSchema>;

export const MarkAttendanceModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const timeZone = useOrgTimezone();
  const create = useCreateAttendance();
  const [serverError, setServerError] = useState<string | null>(null);
  const today = dateKeyIn(timeZone);
  const form = useForm<MarkValues>({ resolver: zodResolver(attendanceCreateSchema) });
  const { register, handleSubmit, reset, formState, setError, control } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (open) {
      setServerError(null);
      reset({ employeeId: '', date: today, checkIn: undefined, checkOut: undefined, status: undefined, workMode: 'OFFICE', note: '' });
    }
  }, [open, reset, today]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await create.mutateAsync(attendanceCreateSchema.parse(values));
      toast.success(res.message ?? 'Attendance recorded');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['employeeId', 'date', 'checkIn', 'checkOut', 'status', 'workMode', 'note']));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark attendance"
      description={`Record attendance for an employee. Times are in ${timeZone}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError error={serverError} />
        <FormField label="Employee" required error={errors.employeeId}>
          {({ id, invalid }) => (
            <Controller control={control} name="employeeId" render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={field.value || null} onChange={(v) => field.onChange((v as string | null) ?? '')} />} />
          )}
        </FormField>
        <FormGrid>
          <FormField label="Date" required error={errors.date}>
            {({ id, invalid }) => <Input id={id} type="date" max={today} aria-invalid={invalid} {...register('date')} />}
          </FormField>
          <FormField label="Work mode" error={errors.workMode}>
            {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={modeOptions} {...register('workMode')} />}
          </FormField>
          <FormField label="Check-in" error={errors.checkIn}>
            {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('checkIn', { setValueAs: (v: string) => v || undefined })} />}
          </FormField>
          <FormField label="Check-out" error={errors.checkOut}>
            {({ id, invalid }) => <Input id={id} type="time" aria-invalid={invalid} {...register('checkOut', { setValueAs: (v: string) => v || undefined })} />}
          </FormField>
        </FormGrid>
        <FormField label="Status" error={errors.status} hint="Required without a check-in (e.g. Absent, Leave). With times, leave on automatic.">
          {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={statusOptions} placeholder="Automatic" {...register('status', { setValueAs: (v: string) => v || undefined })} />}
        </FormField>
        <FormField label="Note" error={errors.note}>
          {({ id, invalid }) => <Textarea id={id} rows={2} maxLength={300} aria-invalid={invalid} {...register('note')} />}
        </FormField>
      </form>
    </Modal>
  );
};
