import { Eye, Pin } from 'lucide-react';
import { Avatar, Badge, EmptyState, ErrorState, ProgressBar, Skeleton, type Tone } from '@/components/ui/display';
import { Modal } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { formatDateTime, fullName } from '@/lib/utils';
import { useAnnouncementReads, type AnnouncementPriority, type AnnouncementStatus } from '../api';

const PRIORITY_TONE: Record<AnnouncementPriority, Tone> = { LOW: 'gray', NORMAL: 'blue', HIGH: 'amber', URGENT: 'red' };
const STATUS_TONE: Record<AnnouncementStatus, Tone> = { PUBLISHED: 'green', SCHEDULED: 'blue', EXPIRED: 'gray' };

export const PriorityBadge = ({ priority, hideNormal }: { priority: AnnouncementPriority; hideNormal?: boolean }) =>
  hideNormal && (priority === 'NORMAL' || priority === 'LOW') ? null : (
    <Badge tone={PRIORITY_TONE[priority]} dot>
      {label(priority)}
    </Badge>
  );

export const AnnouncementStatusBadge = ({ status }: { status: AnnouncementStatus }) => <Badge tone={STATUS_TONE[status]}>{label(status)}</Badge>;

export const PinnedBadge = () => (
  <Badge tone="brand">
    <Pin className="h-3 w-3" aria-hidden />
    Pinned
  </Badge>
);

export const audienceLabel = (audience: string, departments = 0, employees = 0) =>
  audience === 'ALL' ? 'Everyone' : audience === 'DEPARTMENTS' ? `${departments} department${departments === 1 ? '' : 's'}` : `${employees} employee${employees === 1 ? '' : 's'}`;

/** Read tracking: how many of the targeted users opened the announcement. */
export const ReadsDialog = ({ id, title, onClose }: { id: string | null; title?: string; onClose: () => void }) => {
  const reads = useAnnouncementReads(id);
  const r = reads.data;
  return (
    <Modal open={!!id} onClose={onClose} title="Read tracking" description={title} size="md">
      {reads.isLoading ? (
        <div className="space-y-3" role="status" aria-label="Loading read tracking">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : reads.error || !r ? (
        <ErrorState message={reads.error?.message} onRetry={() => reads.refetch()} className="py-8" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Audience', value: r.total },
              { label: 'Read', value: r.read },
              { label: 'Not yet', value: r.unread },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line bg-surface-2 px-2 py-2.5">
                <p className="text-xl font-semibold text-fg tabular-nums">{s.value}</p>
                <p className="text-xs text-muted">{s.label}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>Read rate</span>
              <span className="font-semibold text-fg tabular-nums">{r.readPercent}%</span>
            </div>
            <ProgressBar value={r.readPercent} tone={r.readPercent >= 75 ? 'green' : 'brand'} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-fg">Readers</h3>
            {r.readers.length === 0 ? (
              <EmptyState icon={<Eye className="h-5 w-5" />} title="No one has read this yet" className="py-8" />
            ) : (
              <ul className="scrollbar-thin max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {r.readers.map((reader, i) => {
                  const u = reader.user && typeof reader.user === 'object' ? reader.user : null;
                  const name = u ? fullName(u) : 'Former user';
                  return (
                    <li key={u?._id ?? i} className="flex items-center gap-3 px-3 py-2">
                      <Avatar name={name} src={u?.avatar} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{name}</span>
                        {u?.email && <span className="block truncate text-xs text-muted">{u.email}</span>}
                      </span>
                      {reader.inAudience === false && <Badge tone="gray">Not in audience</Badge>}
                      <span className="shrink-0 text-xs text-muted">{formatDateTime(reader.readAt, 'dd MMM, HH:mm')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
