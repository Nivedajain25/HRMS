import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Eye, Lock, MessageSquareWarning, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, DescriptionList, ErrorState, IconTitle, PageHeader, PageSkeleton } from '@/components/ui/display';
import { Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { cn, formatDateTime, fullName } from '@/lib/utils';
import { CATEGORY_LABEL, STATUS_LABEL, STATUS_TONE, useComplaint, useComplaintStatus, useReplyComplaint, type ComplaintStatus } from './api';

/** One complaint: details, the conversation with HR, a reply box and (HR / admin) status actions. */
export const ComplaintDetailPage = () => {
  const { id = '' } = useParams();
  const q = useComplaint(id);
  const reply = useReplyComplaint(id);
  const setStatus = useComplaintStatus(id);
  const confirm = useConfirm();
  const [message, setMessage] = useState('');

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState message={q.error ? toApiError(q.error).message : undefined} onRetry={() => q.refetch()} />;
  const c = q.data;
  const closed = c.status === 'RESOLVED' || c.status === 'CLOSED';

  const send = () => {
    const text = message.trim();
    if (!text) return;
    reply.mutate(text, {
      onSuccess: () => {
        setMessage('');
        toast.success('Reply sent');
      },
      onError: (e) => toast.error(toApiError(e).message),
    });
  };

  const changeStatus = async (status: ComplaintStatus) => {
    const needsNote = status === 'RESOLVED' || status === 'CLOSED';
    let note = message.trim() || undefined;
    if (needsNote && !note) {
      const r = await confirm({
        title: `Mark ${c.number} as ${STATUS_LABEL[status].toLowerCase()}?`,
        message: 'Tell the employee what was done. They are notified.',
        confirmLabel: `Mark ${STATUS_LABEL[status].toLowerCase()}`,
        tone: 'primary',
        requireReason: true,
        reasonLabel: 'Message to the employee',
      });
      if (!r.confirmed) return;
      note = r.reason;
    }
    setStatus.mutate(
      { status, message: note },
      {
        onSuccess: () => {
          setMessage('');
          toast.success(`Marked as ${STATUS_LABEL[status].toLowerCase()}`);
        },
        onError: (e) => toast.error(toApiError(e).message),
      },
    );
  };

  const person = c.employeeId;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'My Account', to: '/account' }, { label: 'Complaints', to: '/complaints' }, { label: c.number }]}
        title={<IconTitle icon={<MessageSquareWarning />}>{c.subject}</IconTitle>}
        description={`${c.number} · ${CATEGORY_LABEL[c.category]} · raised ${formatDateTime(c.createdAt)}`}
        actions={
          <>
            <Badge tone={STATUS_TONE[c.status]} dot>
              {STATUS_LABEL[c.status]}
            </Badge>
            {c.canHandle && !c.mine && (
              <>
                {c.status === 'OPEN' && (
                  <Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => changeStatus('IN_REVIEW')}>
                    Start review
                  </Button>
                )}
                {!closed && (
                  <Button variant="success" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => changeStatus('RESOLVED')}>
                    Mark resolved
                  </Button>
                )}
                {c.status !== 'CLOSED' && (
                  <Button variant="outline" size="sm" icon={<Lock className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => changeStatus('CLOSED')}>
                    Close
                  </Button>
                )}
                {closed && (
                  <Button variant="outline" size="sm" icon={<RotateCcw className="h-4 w-4" />} loading={setStatus.isPending} onClick={() => changeStatus('OPEN')}>
                    Re-open
                  </Button>
                )}
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {/* The complaint */}
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Avatar name={c.raisedByName} src={person?.profilePhoto} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{c.raisedByName}</p>
                <p className="text-xs text-muted">{formatDateTime(c.createdAt)}</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-fg">{c.description}</p>
          </Card>

          {/* Conversation */}
          {c.replies.length > 0 && (
            <Card className="divide-y divide-line">
              {c.replies.map((r) => (
                <div key={r._id} className={cn('flex gap-3 p-5', r.staff && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                  <Avatar name={r.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-fg">{r.name}</span>
                      {r.staff && <Badge tone="brand">HR</Badge>}
                      {r.status && (
                        <Badge tone={STATUS_TONE[r.status]} dot>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      )}
                      <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                    </p>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-fg-2">{r.message}</p>
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Reply */}
          {c.status !== 'CLOSED' || c.canHandle ? (
            <Card className="p-5">
              <label htmlFor="complaint-reply" className="mb-1.5 block text-sm font-medium text-fg">
                {c.canHandle && !c.mine ? 'Reply to the employee' : 'Add a follow-up'}
              </label>
              <Textarea id="complaint-reply" rows={4} maxLength={3000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message…" />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">{c.mine && closed ? 'Replying re-opens this complaint.' : c.canHandle && !c.mine ? 'The employee is notified of your reply.' : 'HR is notified of your message.'}</p>
                <Button icon={<Send className="h-4 w-4" />} loading={reply.isPending} disabled={!message.trim()} onClick={send}>
                  Send
                </Button>
              </div>
            </Card>
          ) : (
            <p className="text-sm text-muted">This complaint is closed.</p>
          )}
        </div>

        <Card className="h-fit p-5">
          <h2 className="mb-3 text-base font-semibold text-fg">Details</h2>
          <DescriptionList
            columns={1}
            items={[
              { label: 'Number', value: c.number },
              { label: 'Status', value: <Badge tone={STATUS_TONE[c.status]} dot>{STATUS_LABEL[c.status]}</Badge> },
              { label: 'Category', value: CATEGORY_LABEL[c.category] },
              { label: 'Raised by', value: fullName(person) || c.raisedByName },
              ...(person?.employeeId ? [{ label: 'Employee ID', value: person.employeeId }] : []),
              ...(person?.departmentId?.name ? [{ label: 'Department', value: person.departmentId.name }] : []),
              { label: 'Raised on', value: formatDateTime(c.createdAt) },
              ...(c.resolvedAt ? [{ label: c.status === 'CLOSED' ? 'Closed on' : 'Resolved on', value: formatDateTime(c.resolvedAt) }] : []),
            ]}
          />
        </Card>
      </div>
    </>
  );
};
