import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Eye, Lock, MessageSquareHeart, Users } from 'lucide-react';
import { feedbackSchema } from '@stencil/shared';
import { EmployeePicker } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField } from '@/components/forms/form';
import { Pagination } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Avatar, EmptyState, ErrorState, Skeleton } from '@/components/ui/display';
import { Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { ApiError, toApiError, type Paged } from '@/lib/api';
import { cn, formatDateTime, fullName, timeAgo } from '@/lib/utils';
import { useGiveFeedback, type Feedback, type FeedbackVisibility } from '../api';
import { FEEDBACK_TYPES, FeedbackTypeBadge, VISIBILITY_OPTIONS } from './perf-ui';

type In = z.input<typeof feedbackSchema>;
type Out = z.output<typeof feedbackSchema>;

const VISIBILITY_ICON: Record<FeedbackVisibility, typeof Lock> = { PRIVATE: Lock, MANAGER: Users, PUBLIC: Eye };

/** Segmented single-choice control built on native radios (keyboard-operable by default). */
const ChoiceCards = <T extends string>({
  name,
  legend,
  value,
  onChange,
  options,
}: {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description: string }[];
}) => (
  <fieldset>
    <legend className="mb-1.5 block text-sm font-medium text-fg">{legend}</legend>
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer flex-col rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500/40',
            value === o.value ? 'border-brand-600 bg-brand-50 dark:bg-brand-500/10' : 'border-line-strong hover:bg-surface-2',
          )}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          <span className="font-medium text-fg">{o.label}</span>
          <span className="text-xs text-muted">{o.description}</span>
        </label>
      ))}
    </div>
  </fieldset>
);

export const GiveFeedbackModal = ({ open, onClose, employeeId, employeeName }: { open: boolean; onClose: () => void; employeeId?: string; employeeName?: string }) => {
  const give = useGiveFeedback();
  const [serverError, setServerError] = useState<string | null>(null);
  const defaults: In = { employeeId: employeeId ?? '', message: '', type: 'PRAISE', visibility: 'MANAGER' };
  const form = useForm<In, unknown, Out>({ resolver: zodResolver(feedbackSchema), defaultValues: defaults });
  const { control, register, handleSubmit, reset, formState, setError, watch } = form;

  useEffect(() => {
    if (open) {
      reset({ employeeId: employeeId ?? '', message: '', type: 'PRAISE', visibility: 'MANAGER' });
      setServerError(null);
    }
  }, [open, employeeId, reset]);

  const message = watch('message') ?? '';

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await give.mutateAsync(values);
      toast.success(res.message ?? 'Feedback shared');
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Give feedback"
      description={employeeName ? `Share feedback with ${employeeName}.` : 'Recognize a colleague or help them grow.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            Share feedback
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />
        {!employeeId && (
          <FormField label="Colleague" required error={formState.errors.employeeId}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={field.value || null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} />}
              />
            )}
          </FormField>
        )}
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <ChoiceCards name="feedback-type" legend="Type" value={field.value ?? 'GENERAL'} onChange={field.onChange} options={FEEDBACK_TYPES} />
          )}
        />
        <FormField label="Feedback" required error={formState.errors.message} hint={`${message.length} / 2000`}>
          {({ id, invalid, describedBy }) => (
            <Textarea id={id} rows={5} maxLength={2000} aria-invalid={invalid} aria-describedby={describedBy} placeholder="Be specific: what happened, and what was the impact?" {...register('message')} />
          )}
        </FormField>
        <Controller
          control={control}
          name="visibility"
          render={({ field }) => (
            <ChoiceCards name="feedback-visibility" legend="Who can see it" value={field.value ?? 'MANAGER'} onChange={field.onChange} options={VISIBILITY_OPTIONS} />
          )}
        />
      </form>
    </Modal>
  );
};

export const FeedbackItem = ({ item, mode }: { item: Feedback; mode: 'received' | 'given' }) => {
  const vis = VISIBILITY_OPTIONS.find((v) => v.value === item.visibility);
  const Icon = VISIBILITY_ICON[item.visibility] ?? Eye;
  const person = mode === 'given' && item.employeeId ? fullName(item.employeeId) : (item.fromName ?? 'A colleague');
  return (
    <li className="flex gap-3 py-4">
      <Avatar name={person} src={mode === 'given' ? item.employeeId?.profilePhoto : undefined} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-fg">{mode === 'given' ? `To ${person}` : person}</span>
          <FeedbackTypeBadge type={item.type} />
          <span className="flex items-center gap-1 text-xs text-muted" title={vis?.description}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {vis?.label ?? item.visibility}
          </span>
          <time className="ml-auto text-xs text-muted" dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
            {timeAgo(item.createdAt)}
          </time>
        </div>
        <p className="mt-1.5 text-sm whitespace-pre-line text-fg-2">{item.message}</p>
      </div>
    </li>
  );
};

/** Feedback list with loading/empty/error/forbidden states and pagination. */
export const FeedbackList = ({
  query,
  mode,
  emptyTitle,
  emptyDescription,
  onPageChange,
  action,
}: {
  query: { data?: Paged<Feedback>; isLoading: boolean; isFetching: boolean; error: Error | null; refetch: () => unknown };
  mode: 'received' | 'given';
  emptyTitle: string;
  emptyDescription?: string;
  onPageChange?: (page: number) => void;
  action?: React.ReactNode;
}) => {
  if (query.isLoading)
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading feedback">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  if (query.error instanceof ApiError && query.error.status === 403) return <EmptyState icon={<Lock className="h-6 w-6" />} title="Feedback is private" description="You do not have access to this feedback." />;
  if (query.error) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />;
  if (!query.data?.data.length) return <EmptyState icon={<MessageSquareHeart className="h-6 w-6" />} title={emptyTitle} description={emptyDescription} action={action} />;
  return (
    <>
      <ul className="divide-y divide-line px-5">
        {query.data.data.map((f) => (
          <FeedbackItem key={f._id} item={f} mode={mode} />
        ))}
      </ul>
      {onPageChange && query.data.pagination.totalPages > 1 && <Pagination pagination={query.data.pagination} onPageChange={onPageChange} loading={query.isFetching} />}
    </>
  );
};
