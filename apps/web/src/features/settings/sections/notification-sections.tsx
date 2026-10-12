import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ArrowUpRight, Eye, Mail, RotateCcw, Send } from 'lucide-react';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_INFO,
  NOTIFICATION_RECIPIENT_LABELS,
  SELF_RECIPIENTS,
  type NotificationEvent,
  type NotificationEventInfo,
  type NotificationRecipient,
  type NotificationRule,
} from '@stencil/shared';
import { FilterBar, SearchInput } from '@/components/common/controls';
import { FormField } from '@/components/forms/form';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, ErrorState, Skeleton, type Tone } from '@/components/ui/display';
import { Checkbox, DateRangePicker, Input, Select, Switch, Textarea } from '@/components/ui/input';
import { Drawer, Tabs, useConfirm } from '@/components/ui/overlay';
import { useListParams } from '@/hooks/use-list-params';
import { get, getPaged, post, put, toApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/store/auth';

/* --------------------------- Notification rules --------------------------- */

type EventInfo = Omit<NotificationEventInfo, 'type'> & { event: NotificationEvent };
interface NotificationSettings {
  events: EventInfo[];
  rules: Record<NotificationEvent, NotificationRule>;
  customized: NotificationEvent[];
}
interface Preview {
  subject: string;
  html: string;
  text: string;
  sentTo: string | null;
}

const SETTINGS_KEY = ['notification-settings'] as const;
const useNotificationSettings = () => useQuery({ queryKey: SETTINGS_KEY, queryFn: () => get<NotificationSettings>('/notification-settings') });

const useSaveRules = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: Partial<Record<NotificationEvent, Partial<NotificationRule> | null>>) => put<NotificationSettings>('/notification-settings', { rules }),
    onSuccess: (res) => qc.setQueryData(SETTINGS_KEY, res.data),
    onError: (e) => toast.error(toApiError(e).message),
  });
};

const recipientsText = (r: NotificationRule) => r.recipients.map((k) => NOTIFICATION_RECIPIENT_LABELS[k]).join(', ') || 'Nobody';

/** HR / Admin: which automated leave and interview notifications go out, to whom, and what they say. */
export const NotificationRulesSection = () => {
  const settings = useNotificationSettings();
  const save = useSaveRules();
  const [editing, setEditing] = useState<NotificationEvent | null>(null);

  if (settings.isLoading) return <Skeleton className="h-96" />;
  if (settings.error || !settings.data) return <ErrorState message={settings.error?.message} onRetry={() => settings.refetch()} />;
  const { events, rules, customized } = settings.data;
  const groups = ['Leave', 'Interviews'] as const;
  const info = editing ? events.find((e) => e.event === editing) : undefined;

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <Card key={group}>
          <CardHeader
            title={group === 'Leave' ? 'Leave' : 'Interviews'}
            description={
              group === 'Leave'
                ? 'Sent to the reporting manager, HR and Admin. If the manager is on leave or unavailable, the next manager up the reporting line gets it. HR is copied on the emails.'
                : 'Sent to interviewers, the hiring manager, recruiters and the candidate (email only, as candidates have no account).'
            }
          />
          <ul className="divide-y divide-line">
            {events
              .filter((e) => e.group === group)
              .map((e) => {
                const rule = rules[e.event];
                return (
                  <li key={e.event} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                    <Switch label={`${e.label} on or off`} checked={rule.enabled} disabled={save.isPending} onChange={(enabled) => save.mutate({ [e.event]: { enabled } }, { onSuccess: () => toast.success(`${e.label}: ${enabled ? 'on' : 'off'}`) })} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                        {e.label}
                        {customized.includes(e.event) && <Badge tone="brand">Customized</Badge>}
                        {!rule.enabled && <Badge>Off</Badge>}
                      </p>
                      <p className="truncate text-sm text-muted">
                        {recipientsText(rule)}
                        {rule.ccHr && ' · HR in CC'}
                        {rule.escalate && group === 'Leave' && ' · escalates'}
                        {' · '}
                        {[rule.inApp && 'in-app', rule.email && 'email'].filter(Boolean).join(' + ') || 'no channel'}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setEditing(e.event)}>
                      Edit
                    </Button>
                  </li>
                );
              })}
          </ul>
        </Card>
      ))}
      {info && <RuleEditor key={info.event} info={info} rule={rules[info.event]} customized={customized.includes(info.event)} onClose={() => setEditing(null)} />}
    </div>
  );
};

const RuleEditor = ({ info, rule, customized, onClose }: { info: EventInfo; rule: NotificationRule; customized: boolean; onClose: () => void }) => {
  const [draft, setDraft] = useState<NotificationRule>(() => structuredClone(rule));
  const [audience, setAudience] = useState<'team' | 'self'>('team');
  const [field, setField] = useState<'subject' | 'body'>('body');
  const save = useSaveRules();
  const confirm = useConfirm();
  const hasSelf = info.recipients.some((r) => SELF_RECIPIENTS.includes(r));
  const selfWho = info.recipients.includes('CANDIDATE') ? 'candidate' : 'employee';
  const set = <K extends keyof NotificationRule>(k: K, v: NotificationRule[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const subjectKey = audience === 'self' ? 'selfSubject' : 'subject';
  const bodyKey = audience === 'self' ? 'selfBody' : 'body';

  const preview = useMutation({
    mutationFn: (sendTest: boolean) => post<Preview>('/notification-settings/preview', { event: info.event, audience, rule: draft, sendTest }),
    onSuccess: (res, sendTest) => sendTest && res.data.sentTo && toast.success(`Test email sent to ${res.data.sentTo}`),
    onError: (e) => toast.error(toApiError(e).message),
  });
  // Re-render the preview when switching between the team and the employee / candidate message.
  useEffect(() => {
    preview.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const insert = (p: string) => {
    const key = field === 'subject' ? subjectKey : bodyKey;
    set(key, `${draft[key]}${draft[key].endsWith(' ') || !draft[key] ? '' : ' '}{{${p}}}`);
  };

  const restore = async () => {
    if (!(await confirm({ title: `Restore the default for "${info.label}"?`, message: 'Recipients, switches and the message text go back to how they shipped.', confirmLabel: 'Restore defaults' }))) return;
    save.mutate({ [info.event]: null }, { onSuccess: () => (toast.success('Defaults restored'), onClose()) });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={info.label}
      description={info.description}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} disabled={!customized} onClick={restore}>
            Restore defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate({ [info.event]: draft }, { onSuccess: () => (toast.success('Notification rule saved'), onClose()) })}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6 text-sm">
        <section className="space-y-3">
          <ToggleLine title="Send this notification" checked={draft.enabled} onChange={(v) => set('enabled', v)} />
          <ToggleLine title="In-app" description="Bell, dashboard and phone push for people with an account." checked={draft.inApp} onChange={(v) => set('inApp', v)} />
          <ToggleLine title="Email" checked={draft.email} onChange={(v) => set('email', v)} />
          <ToggleLine title="Copy HR on the emails (CC)" description="HR stays in CC on escalated emails too." checked={draft.ccHr} onChange={(v) => set('ccHr', v)} />
          {info.group === 'Leave' && (
            <ToggleLine
              title="Escalate when the manager is away"
              description="If the reporting manager is on leave, marked on leave, has left, or has no email, the next manager up the reporting line is told instead."
              checked={draft.escalate}
              onChange={(v) => set('escalate', v)}
            />
          )}
        </section>

        <section>
          <p className="mb-2 font-medium text-fg">Who is told</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {info.recipients.map((r: NotificationRecipient) => (
              <Checkbox
                key={r}
                label={NOTIFICATION_RECIPIENT_LABELS[r]}
                description={r === 'CANDIDATE' ? 'Email only' : r === 'EMPLOYEE' ? 'The person on leave' : undefined}
                checked={draft.recipients.includes(r)}
                onChange={(e) => set('recipients', e.target.checked ? [...draft.recipients, r] : draft.recipients.filter((x) => x !== r))}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Whoever did the action (e.g. the manager who approved) isn’t notified about it.</p>
        </section>

        <section className="space-y-3">
          {hasSelf && (
            <Tabs
              tabs={[
                { key: 'team', label: 'Message to the team' },
                { key: 'self', label: `Message to the ${selfWho}` },
              ]}
              active={audience}
              onChange={(k) => setAudience(k as 'team' | 'self')}
            />
          )}
          <FormField label="Subject">
            {({ id }) => <Input id={id} value={draft[subjectKey]} maxLength={200} onFocus={() => setField('subject')} onChange={(e) => set(subjectKey, e.target.value)} />}
          </FormField>
          <FormField label="Message" hint="Plain text. Blank lines start a new paragraph; links become clickable. Lines whose placeholder is empty are left out.">
            {({ id }) => <Textarea id={id} rows={9} value={draft[bodyKey]} maxLength={4000} onFocus={() => setField('body')} onChange={(e) => set(bodyKey, e.target.value)} className="font-mono text-[13px]" />}
          </FormField>
          <div>
            <p className="mb-1.5 text-xs text-muted">Insert into the {field === 'subject' ? 'subject' : 'message'}:</p>
            <div className="flex flex-wrap gap-1.5">
              {info.placeholders.map((p) => (
                <button key={p} type="button" onClick={() => insert(p)} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-2 hover:border-brand-400 hover:text-brand-600">
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-fg">Preview (sample data)</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />} loading={preview.isPending && !preview.variables} onClick={() => preview.mutate(false)}>
                Refresh preview
              </Button>
              <Button variant="outline" size="sm" icon={<Send className="h-4 w-4" />} loading={preview.isPending && preview.variables} onClick={() => preview.mutate(true)}>
                Send test to me
              </Button>
            </div>
          </div>
          {preview.data ? (
            <div className="overflow-hidden rounded-lg border border-line">
              <p className="border-b border-line bg-surface-2 px-3 py-2 text-xs">
                <span className="text-muted">Subject:</span> <span className="font-medium text-fg">{preview.data.data.subject}</span>
              </p>
              {/* Server-rendered email; templates are HTML-escaped there. Sandboxed: no scripts, no same-origin access. */}
              <iframe title="Email preview" sandbox="" srcDoc={preview.data.data.html} className="h-[420px] w-full bg-white" />
            </div>
          ) : (
            <Skeleton className="h-[420px]" />
          )}
        </section>
      </div>
    </Drawer>
  );
};

const ToggleLine = ({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-start justify-between gap-6">
    <div>
      <p className="font-medium text-fg">{title}</p>
      {description && <p className="text-muted">{description}</p>}
    </div>
    <Switch checked={checked} onChange={onChange} label={title} />
  </div>
);

/* ---------------------------- Notification log ---------------------------- */

interface LogRecipient {
  role: string;
  name: string;
  email: string | null;
  inApp: boolean;
  emailAs: 'TO' | 'CC' | null;
  skipped: string | null;
}
interface LogEscalation {
  fromName: string;
  toName: string | null;
  reason: string;
}
type EmailSummary = 'SENT' | 'FAILED' | 'PARTIAL' | 'PENDING' | 'NOT_CONFIGURED' | 'NONE';
interface LogRow {
  _id: string;
  event: NotificationEvent;
  label: string;
  title: string;
  actorName: string | null;
  outcome: 'SENT' | 'NO_RECIPIENTS' | 'DISABLED' | 'ERROR';
  error: string | null;
  recipients: LogRecipient[];
  escalations: LogEscalation[];
  createdAt: string;
  email: EmailSummary;
  counts: { inApp: number; to: number; cc: number; skipped: number };
}
interface LogEmail {
  _id: string;
  to: string;
  cc: string[];
  subject: string;
  status: 'QUEUED' | 'RETRYING' | 'SENT' | 'SKIPPED' | 'FAILED';
  error: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
}
type LogEntry = Omit<LogRow, 'email' | 'counts'> & { emails: LogEmail[]; entityType: string };

const EMAIL_TONE: Record<EmailSummary, { tone: Tone; text: string }> = {
  SENT: { tone: 'green', text: 'Delivered' },
  FAILED: { tone: 'red', text: 'Failed' },
  PARTIAL: { tone: 'amber', text: 'Partly failed' },
  PENDING: { tone: 'blue', text: 'Sending' },
  NOT_CONFIGURED: { tone: 'gray', text: 'Not sent (no SMTP)' },
  NONE: { tone: 'gray', text: 'No email' },
};
const EMAIL_STATUS_TONE: Record<LogEmail['status'], { tone: Tone; text: string }> = {
  SENT: { tone: 'green', text: 'Delivered' },
  SKIPPED: { tone: 'gray', text: 'Not sent (no SMTP)' },
  QUEUED: { tone: 'blue', text: 'Queued' },
  RETRYING: { tone: 'amber', text: 'Retrying' },
  FAILED: { tone: 'red', text: 'Failed' },
};
const OUTCOME_TEXT: Record<LogRow['outcome'], string> = { SENT: '', NO_RECIPIENTS: 'Nobody to notify', DISABLED: 'Switched off', ERROR: 'Error' };
const STATUS_FILTERS = [
  { value: 'FAILED', label: 'Email failed' },
  { value: 'PENDING', label: 'Email sending / retrying' },
  { value: 'ESCALATED', label: 'Escalated' },
  { value: 'NO_RECIPIENTS', label: 'Nobody to notify' },
  { value: 'DISABLED', label: 'Switched off' },
  { value: 'ERROR', label: 'Error' },
];
const ROLE_LABEL = (role: string) => (role === 'APPROVER' ? 'Approver' : (NOTIFICATION_RECIPIENT_LABELS as Record<string, string>)[role] ?? role);

/** HR / Admin (audit:read): every automated notification, who got it and how, delivery status and escalations. */
export const NotificationLogSection = () => {
  const { params, query, set, clear, hasFilters } = useListParams();
  const { search, event, status, from, to, page, limit } = query as Record<string, string | number | undefined>;
  const apiQuery = { page, limit, q: search, event, status, from, to };
  const logs = useQuery({ queryKey: ['notification-log', apiQuery], queryFn: () => getPaged<LogRow>('/notification-log', apiQuery), placeholderData: keepPreviousData });
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: ColumnDef<LogRow, unknown>[] = [
    { id: 'when', header: 'When', cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span> },
    {
      id: 'event',
      header: 'Notification',
      cell: ({ row }) => (
        <div className="min-w-0 max-w-80">
          <p className="truncate font-medium text-fg">{row.original.title}</p>
          <p className="text-xs text-muted">
            {row.original.label}
            {row.original.actorName && ` · by ${row.original.actorName}`}
          </p>
        </div>
      ),
    },
    {
      id: 'recipients',
      header: 'Recipients',
      cell: ({ row }) => {
        const c = row.original.counts;
        return row.original.outcome !== 'SENT' ? (
          <Badge tone={row.original.outcome === 'ERROR' ? 'red' : 'gray'}>{OUTCOME_TEXT[row.original.outcome]}</Badge>
        ) : (
          <span className="text-xs text-fg-2">
            {c.inApp} in-app · {c.to} to{c.cc ? ` · ${c.cc} cc` : ''}
          </span>
        );
      },
    },
    {
      id: 'email',
      header: 'Email',
      cell: ({ row }) => <Badge tone={EMAIL_TONE[row.original.email].tone}>{EMAIL_TONE[row.original.email].text}</Badge>,
    },
    {
      id: 'escalated',
      header: 'Escalated',
      cell: ({ row }) => (row.original.escalations.length ? <Badge tone="amber">{`→ ${row.original.escalations.at(-1)!.toName ?? 'HR'}`}</Badge> : <span className="text-muted">—</span>),
    },
  ];

  return (
    <>
      <DataTable
        caption="Notification log"
        columns={columns}
        data={logs.data?.data}
        loading={logs.isLoading || logs.isFetching}
        error={logs.error}
        onRetry={() => logs.refetch()}
        pagination={logs.data?.pagination}
        onPageChange={(p) => set({ page: p })}
        onRowClick={(r) => setOpenId(r._id)}
        getRowId={(r) => r._id}
        emptyTitle="No automated notifications yet"
        emptyDescription="Leave and interview notifications appear here as they go out."
        toolbar={
          <FilterBar active={hasFilters(['search', 'event', 'status', 'from', 'to'])} onClear={() => clear()}>
            <SearchInput value={params.search} onSearch={(s) => set({ search: s })} placeholder="Search title or person…" />
            <Select
              aria-label="Event"
              className="w-52"
              value={String(params.event ?? '')}
              onChange={(e) => set({ event: e.target.value })}
              options={NOTIFICATION_EVENTS.map((e) => ({ value: e, label: NOTIFICATION_EVENT_INFO[e].label }))}
              placeholder="All events"
            />
            <Select aria-label="Status" className="w-52" value={String(params.status ?? '')} onChange={(e) => set({ status: e.target.value })} options={STATUS_FILTERS} placeholder="Any status" />
            <DateRangePicker from={params.from as string | undefined} to={params.to as string | undefined} onChange={(r) => set({ from: r.from, to: r.to })} />
          </FilterBar>
        }
      />
      {openId && <LogDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
};

const LogDetail = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const entry = useQuery({ queryKey: ['notification-log', 'entry', id], queryFn: () => get<LogEntry>(`/notification-log/${id}`) });
  const retry = useMutation({
    mutationFn: (emailId: string) => post(`/notification-log/emails/${emailId}/retry`),
    onSuccess: async () => {
      toast.success('Email queued again');
      await qc.invalidateQueries({ queryKey: ['notification-log'] });
    },
    onError: (e) => toast.error(toApiError(e).message),
  });
  const e = entry.data;

  return (
    <Drawer open onClose={onClose} width="max-w-2xl" title={e?.title ?? 'Notification'} description={e ? `${e.label} · ${formatDateTime(e.createdAt)}${e.actorName ? ` · by ${e.actorName}` : ''}` : undefined}>
      {entry.isLoading ? (
        <Skeleton className="h-64" />
      ) : entry.error || !e ? (
        <ErrorState message={entry.error?.message} onRetry={() => entry.refetch()} />
      ) : (
        <div className="space-y-6 text-sm">
          {(e.outcome !== 'SENT' || e.error) && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              {OUTCOME_TEXT[e.outcome] && <strong>{OUTCOME_TEXT[e.outcome]}. </strong>}
              {e.error}
            </p>
          )}

          {e.escalations.length > 0 && (
            <section>
              <p className="mb-2 font-medium text-fg">Escalation</p>
              <ul className="space-y-1">
                {e.escalations.map((x, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-fg-2">
                    {x.fromName} {x.reason} <ArrowUpRight className="h-3.5 w-3.5 text-amber-600" /> <span className="font-medium text-fg">{x.toName ?? 'HR'}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className="mb-2 font-medium text-fg">Recipients</p>
            <Card>
              <ul className="divide-y divide-line">
                {e.recipients.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-fg">{r.name}</p>
                      <p className="truncate text-xs text-muted">
                        {ROLE_LABEL(r.role)}
                        {r.email && ` · ${r.email}`}
                      </p>
                    </div>
                    {r.skipped ? (
                      <span className="text-xs text-muted">Not sent: {r.skipped}</span>
                    ) : (
                      <>
                        {r.inApp && <Badge tone="brand">In-app</Badge>}
                        {r.emailAs && <Badge tone={r.emailAs === 'CC' ? 'gray' : 'blue'}>{`Email ${r.emailAs === 'CC' ? 'CC' : 'To'}`}</Badge>}
                      </>
                    )}
                  </li>
                ))}
                {!e.recipients.length && <li className="px-4 py-3 text-muted">Nobody</li>}
              </ul>
            </Card>
          </section>

          <section>
            <p className="mb-2 font-medium text-fg">Emails</p>
            {e.emails.length ? (
              <div className="space-y-2">
                {e.emails.map((m) => (
                  <Card key={m._id}>
                    <CardBody className="space-y-1.5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-2 font-medium text-fg">
                          <Mail className="h-4 w-4 shrink-0 text-muted" />
                          <span className="truncate">{m.subject}</span>
                        </p>
                        <Badge tone={EMAIL_STATUS_TONE[m.status].tone}>{EMAIL_STATUS_TONE[m.status].text}</Badge>
                      </div>
                      <p className="text-xs text-fg-2">
                        <span className="text-muted">To:</span> {m.to}
                      </p>
                      {m.cc?.length > 0 && (
                        <p className="text-xs text-fg-2">
                          <span className="text-muted">CC:</span> {m.cc.join(', ')}
                        </p>
                      )}
                      <p className="text-xs text-muted">
                        {m.attempts} attempt{m.attempts === 1 ? '' : 's'}
                        {m.sentAt ? ` · sent ${formatDateTime(m.sentAt)}` : m.lastAttemptAt ? ` · last try ${formatDateTime(m.lastAttemptAt)}` : ''}
                      </p>
                      {m.error && <p className="text-xs text-red-600 dark:text-red-400">{m.error}</p>}
                      {m.status === 'FAILED' && can('settings:manage') && (
                        <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} loading={retry.isPending && retry.variables === m._id} onClick={() => retry.mutate(m._id, { onSuccess: () => entry.refetch() })}>
                          Send again
                        </Button>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-muted">No email for this notification.</p>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
};
