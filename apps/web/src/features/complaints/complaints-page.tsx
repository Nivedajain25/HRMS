import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronRight, MessageSquareWarning, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, IconTitle, PageHeader, Skeleton } from '@/components/ui/display';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/overlay';
import { FormError, FormField } from '@/components/forms/form';
import { toApiError } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { CATEGORY_LABEL, COMPLAINT_CATEGORIES, STATUS_LABEL, STATUS_TONE, useComplaints, useCreateComplaint, type ComplaintCategory, type ComplaintStatus } from './api';

const NewComplaintModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const create = useCreateComplaint();
  const [form, setForm] = useState<{ category: ComplaintCategory | ''; subject: string; description: string }>({ category: '', subject: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  const close = () => {
    setForm({ category: '', subject: '', description: '' });
    setErrors({});
    setBanner(null);
    onClose();
  };

  const submit = () => {
    const fe: Record<string, string> = {};
    if (!form.category) fe.category = 'Choose a category';
    if (!form.subject.trim()) fe.subject = 'Enter a subject';
    if (form.description.trim().length < 10) fe.description = 'Describe the problem (at least 10 characters)';
    setErrors(fe);
    if (Object.keys(fe).length) return;
    create.mutate(
      { category: form.category as ComplaintCategory, subject: form.subject.trim(), description: form.description.trim() },
      {
        onSuccess: (res) => {
          toast.success(`Complaint ${res.data.number} submitted — HR has been notified`);
          close();
        },
        onError: (e) => setBanner(toApiError(e).message),
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Raise a complaint"
      description="Your complaint goes to HR and the admin team. Your name is shared with them so they can follow up."
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Submit complaint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError error={banner} />
        <FormField label="Category" required error={errors.category}>
          {({ id, invalid }) => (
            <Select
              id={id}
              aria-invalid={invalid}
              placeholder="Choose a category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as ComplaintCategory })}
              options={COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            />
          )}
        </FormField>
        <FormField label="Subject" required error={errors.subject}>
          {({ id, invalid }) => <Input id={id} aria-invalid={invalid} maxLength={150} placeholder="A short summary" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}
        </FormField>
        <FormField label="Details" required error={errors.description} hint="What happened, when, and who was involved.">
          {({ id, invalid }) => <Textarea id={id} aria-invalid={invalid} rows={6} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </FormField>
      </div>
    </Modal>
  );
};

const TABS: { key: ComplaintStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'IN_REVIEW', label: 'In review' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
];

/** Complaints: raise and follow my own; HR / admin also see everyone's (All complaints). */
export const ComplaintsPage = () => {
  const { can } = usePermissions();
  const handler = can('employee:update');
  const [scope, setScope] = useState<'me' | 'all'>(handler ? 'all' : 'me');
  const [status, setStatus] = useState<ComplaintStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const q = useComplaints({ scope, status: status === 'ALL' ? undefined : status, search: search.trim() || undefined, page });
  const rows = q.data?.items ?? [];
  const counts = q.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  const pg = q.data?.pagination;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'My Account', to: '/account' }, { label: 'Complaints' }]}
        title={<IconTitle icon={<MessageSquareWarning />}>Complaints</IconTitle>}
        description={handler ? 'Complaints raised by employees — review, reply and resolve them.' : 'Raise a complaint with HR and follow its progress.'}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Raise a complaint
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Status">
            {TABS.map((t) => {
              const n = t.key === 'ALL' ? total : (counts[t.key] ?? 0);
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={status === t.key}
                  onClick={() => {
                    setStatus(t.key);
                    setPage(1);
                  }}
                  className={cn('rounded-lg px-3 py-1.5 text-sm font-medium', status === t.key ? 'bg-brand-600 text-white' : 'text-fg-2 hover:bg-surface-3')}
                >
                  {t.label}
                  <span className={cn('ml-1.5 text-xs tabular-nums', status === t.key ? 'text-white/80' : 'text-muted')}>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {handler && (
              <div role="radiogroup" aria-label="Whose complaints" className="flex rounded-lg border border-line p-0.5">
                {(
                  [
                    ['all', 'All complaints'],
                    ['me', 'Raised by me'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={scope === k}
                    onClick={() => {
                      setScope(k);
                      setPage(1);
                    }}
                    className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', scope === k ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <Input
              className="w-56"
              leftIcon={<Search className="h-4 w-4" />}
              placeholder={handler ? 'Search subject, number, name' : 'Search subject or number'}
              aria-label="Search complaints"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {q.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            className="py-14"
            icon={<MessageSquareWarning className="h-6 w-6" />}
            title={search || status !== 'ALL' ? 'No complaints match' : scope === 'all' ? 'No complaints yet' : 'You haven’t raised any complaints'}
            description={scope === 'me' && !search && status === 'ALL' ? 'If something is wrong at work, let HR know — they will follow up with you here.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c._id}>
                <Link to={`/complaints/${c._id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-muted tabular-nums">{c.number}</span>
                      <span className="truncate font-medium text-fg">{c.subject}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {[CATEGORY_LABEL[c.category], scope === 'all' ? c.raisedByName : null, c.employeeId?.departmentId?.name, `Raised ${formatDate(c.createdAt)}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[c.status]} dot>
                    {STATUS_LABEL[c.status]}
                  </Badge>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {pg && pg.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
            <span>{`Page ${pg.page} of ${pg.totalPages}`}</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pg.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          </div>
        )}
      </Card>

      <NewComplaintModal open={open} onClose={() => setOpen(false)} />
    </>
  );
};
