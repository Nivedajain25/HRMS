import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, CheckCircle2, DoorOpen, Mail, MapPin, Phone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/display';
import { Textarea } from '@/components/ui/input';
import { formatDate } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { CATEGORY_META, useDecideEmergency, useEmergency, useUpdateEmergency } from './api';
import { mapsLink, personName } from './components/emergency-alerts';
import { STATUS_BADGE } from './emergencies-page';

const at = (iso?: string | null) => (iso ? formatDate(iso, 'dd MMM yyyy, HH:mm') : '');

export const EmergencyDetailPage = () => {
  const { id } = useParams();
  const { can } = usePermissions();
  const isHr = can('emergency:manage');
  const q = useEmergency(id);
  const update = useUpdateEmergency();
  const decide = useDecideEmergency();
  const [note, setNote] = useState('');

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState className="card" message={q.error?.message} onRetry={() => q.refetch()} />;
  const e = q.data;
  const cat = CATEGORY_META[e.category];
  const who = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : 'HR');

  const act = async (status: 'ACKNOWLEDGED' | 'RESOLVED') => {
    await update.mutateAsync({ id: e._id, status, note: note.trim() || undefined });
    setNote('');
    toast.success(status === 'RESOLVED' ? 'Emergency closed' : 'The employee has been told HR has seen it');
  };

  const decideAs = async (decision: 'APPROVED' | 'DECLINED') => {
    await decide.mutateAsync({ id: e._id, decision, note: note.trim() || undefined });
    setNote('');
    toast.success(decision === 'APPROVED' ? 'Approved — the employee has been told they can leave' : 'Declined — the employee has been told');
  };

  const timeline = [
    { label: `Raised by ${personName(e)}`, when: e.createdAt },
    ...(e.acknowledgedAt ? [{ label: `Seen by ${who(e.acknowledgedBy)}`, when: e.acknowledgedAt }] : []),
    ...e.notes.map((n) => ({ label: `${n.byName ?? 'HR'}: ${n.text}`, when: n.at })),
    ...(e.decidedAt
      ? [{ label: `${e.decision === 'APPROVED' ? 'Approved' : 'Declined'} by ${who(e.decidedBy)}`, when: e.decidedAt }]
      : e.resolvedAt
        ? [{ label: `Closed by ${who(e.resolvedBy)}`, when: e.resolvedAt }]
        : []),
  ].sort((a, b) => Date.parse(a.when) - Date.parse(b.when));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumb={[{ label: 'Emergencies', to: '/emergencies' }, { label: `${cat.title} · ${personName(e)}` }]}
        title={`${cat.emoji} ${cat.title}`}
        description={`Raised ${at(e.createdAt)}`}
        actions={
          e.decision ? (
            <Badge tone={e.decision === 'APPROVED' ? 'green' : 'red'} dot>
              {e.decision === 'APPROVED' ? 'Approved' : 'Declined'}
            </Badge>
          ) : (
            <Badge tone={STATUS_BADGE[e.status].tone} dot>
              {STATUS_BADGE[e.status].label}
            </Badge>
          )
        }
      />

      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={personName(e)} src={e.employeeId?.profilePhoto} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-fg">{personName(e)}</p>
                <p className="truncate text-sm text-muted">
                  {[e.employeeId?.designationId?.name, e.employeeId?.departmentId?.name].filter(Boolean).join(' · ') || e.employeeId?.employeeId}
                </p>
              </div>
            </div>
            {e.needToLeave && (
              <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                <DoorOpen className="h-3.5 w-3.5" aria-hidden /> Needs to leave work now
              </p>
            )}
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-500/15 dark:text-red-100">{e.message ? `“${e.message}”` : 'No details were given.'}</p>
            <div className="flex flex-wrap gap-2">
              {e.contactPhone && (
                <a href={`tel:${e.contactPhone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
                  <Phone className="h-4 w-4" aria-hidden /> Call {e.contactPhone}
                </a>
              )}
              {e.employeeId?.workEmail && (
                <a href={`mailto:${e.employeeId.workEmail}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2">
                  <Mail className="h-4 w-4" aria-hidden /> Email
                </a>
              )}
              {mapsLink(e) && (
                <a href={mapsLink(e)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2">
                  <MapPin className="h-4 w-4" aria-hidden /> See location on map
                </a>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold text-fg">Timeline</h2>
            <ol className="space-y-3 border-l border-line pl-4">
              {timeline.map((t, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-surface" aria-hidden />
                  <p className="text-sm text-fg">{t.label}</p>
                  <p className="text-xs text-muted">{at(t.when)}</p>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        {isHr && e.status !== 'RESOLVED' && (
          <Card>
            <CardBody className="space-y-3">
              <h2 className="text-sm font-semibold text-fg">Respond</h2>
              <Textarea rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Message to the employee (optional), e.g. Take care, we’ve marked today as emergency leave" />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="success" icon={<Check className="h-4 w-4" />} loading={decide.isPending} onClick={() => decideAs('APPROVED')}>
                  Approve
                </Button>
                <Button variant="danger" icon={<X className="h-4 w-4" />} loading={decide.isPending} onClick={() => decideAs('DECLINED')}>
                  Decline
                </Button>
                {e.status === 'OPEN' && (
                  <Button variant="outline" loading={update.isPending} onClick={() => act('ACKNOWLEDGED')}>
                    Acknowledge
                  </Button>
                )}
                {e.status === 'ACKNOWLEDGED' && note.trim() && (
                  <Button variant="outline" loading={update.isPending} onClick={() => act('ACKNOWLEDGED')}>
                    Add note
                  </Button>
                )}
                <Button variant="ghost" icon={<CheckCircle2 className="h-4 w-4" />} loading={update.isPending} onClick={() => act('RESOLVED')}>
                  Just close
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
};
