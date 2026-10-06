import { CheckCircle2, Download, Eye, Lock, Trash2, Upload, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, DescriptionList, ErrorState, PersonCell, Skeleton } from '@/components/ui/display';
import { Drawer } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { cn, formatBytes, formatDate, formatDateTime, fullName } from '@/lib/utils';
import { isPreviewable, useDocument, useDocumentVersions, type DocumentRecord, type UserName } from '../api';
import { DocumentTypeIcon, ExpiryBadge, useDocumentActions, useDocumentPermissions } from './document-ui';

const personName = (p: UserName | string | null | undefined) => (p && typeof p === 'object' ? fullName(p) : null);

const VersionList = ({ id, currentId }: { id: string; currentId: string }) => {
  const versions = useDocumentVersions(id);
  const actions = useDocumentActions();
  if (versions.isLoading) return <Skeleton className="h-24" />;
  if (versions.error) return <ErrorState message={versions.error.message} onRetry={() => versions.refetch()} className="py-6" />;
  const rows = versions.data ?? [];
  if (!rows.length) return <p className="text-sm text-muted">No versions found.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {rows.map((v) => (
        <li key={v._id} className="relative">
          <span
            className={cn('absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface', v.isLatest ? 'bg-brand-600' : 'bg-line-strong')}
            aria-hidden
          />
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                Version {v.version}
                {v.isLatest && <Badge tone="brand">Current</Badge>}
                {v._id === currentId && !v.isLatest && <Badge>Viewing</Badge>}
                <StatusBadge status={v.verificationStatus} />
              </p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {v.originalName} · {formatBytes(v.size)}
              </p>
              <p className="text-xs text-muted">
                {formatDateTime(v.createdAt)}
                {v.uploadedBy ? ` · ${fullName(v.uploadedBy)}` : ''}
              </p>
              {v.verificationNote && <p className="mt-1 text-xs text-fg-2">“{v.verificationNote}”</p>}
            </div>
            <div className="flex gap-1">
              {isPreviewable(v.mimeType) && (
                <Button variant="ghost" size="icon-sm" aria-label={`Preview version ${v.version}`} onClick={() => actions.preview(v)}>
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label={`Download version ${v.version}`} onClick={() => actions.download(v)}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
};

export const DocumentDetailDrawer = ({
  id,
  onClose,
  onNewVersion,
}: {
  id: string | null;
  onClose: () => void;
  onNewVersion: (doc: DocumentRecord) => void;
}) => {
  const doc = useDocument(id);
  const actions = useDocumentActions();
  const perms = useDocumentPermissions();
  const d = doc.data;

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={d ? d.title : 'Document'}
      description={d ? `${label(d.category)} · version ${d.version}` : undefined}
      footer={
        d ? (
          <>
            {perms.canDelete(d) && (
              <Button variant="ghost" className="mr-auto text-red-600 dark:text-red-400" icon={<Trash2 className="h-4 w-4" />} onClick={() => actions.remove(d, onClose)}>
                Delete
              </Button>
            )}
            {perms.canVerify(d) && d.verificationStatus !== 'REJECTED' && (
              <Button variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={() => actions.reject(d)} disabled={actions.busy}>
                Reject
              </Button>
            )}
            {perms.canVerify(d) && d.verificationStatus !== 'VERIFIED' && (
              <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => actions.verify(d)} disabled={actions.busy}>
                Verify
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {doc.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : doc.error || !d ? (
        <ErrorState message={doc.error?.message} onRetry={() => doc.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                <DocumentTypeIcon mimeType={d.mimeType} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{d.originalName}</p>
                <p className="text-xs text-muted">{formatBytes(d.size)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {isPreviewable(d.mimeType) && (
                <Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => actions.preview(d)}>
                  Preview
                </Button>
              )}
              <Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => actions.download(d)}>
                Download
              </Button>
              {perms.canNewVersion(d) && d.isLatest && (
                <Button variant="outline" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => onNewVersion(d)}>
                  New version
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.verificationStatus} />
            <ExpiryBadge expiry={d.expiryDate} />
            {d.confidential && (
              <Badge tone="purple">
                <Lock className="h-3 w-3" aria-hidden /> Confidential
              </Badge>
            )}
            {!d.isLatest && <Badge tone="amber">Older version</Badge>}
          </div>

          {d.verificationStatus === 'REJECTED' && d.verificationNote && (
            <div role="note" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              <span className="font-medium">Rejected:</span> {d.verificationNote}
            </div>
          )}

          <DescriptionList
            items={[
              {
                label: 'Belongs to',
                value: d.employeeId ? <PersonCell name={fullName(d.employeeId)} subtitle={d.employeeId.employeeId} photo={d.employeeId.profilePhoto} to={`/employees/${d.employeeId._id}`} /> : 'Company-wide',
              },
              { label: 'Category', value: label(d.category) },
              { label: 'Expiry date', value: d.expiryDate ? formatDate(d.expiryDate) : null },
              { label: 'Uploaded', value: `${formatDateTime(d.createdAt)}${d.uploadedBy ? ` by ${fullName(d.uploadedBy)}` : ''}` },
              {
                label: 'Verification',
                value:
                  d.verificationStatus === 'PENDING'
                    ? 'Awaiting review'
                    : `${label(d.verificationStatus)}${d.verifiedAt ? ` on ${formatDateTime(d.verifiedAt)}` : ''}${personName(d.verifiedBy) ? ` by ${personName(d.verifiedBy)}` : ''}`,
              },
              ...(d.verificationNote && d.verificationStatus !== 'REJECTED' ? [{ label: 'Verification note', value: d.verificationNote }] : []),
            ]}
          />
          {d.description && (
            <div>
              <h3 className="text-xs font-medium text-muted">Description</h3>
              <p className="mt-1 text-sm whitespace-pre-line text-fg">{d.description}</p>
            </div>
          )}

          <section aria-labelledby="doc-versions">
            <h3 id="doc-versions" className="mb-3 text-sm font-semibold text-fg">
              Version history
            </h3>
            <VersionList id={d._id} currentId={d._id} />
          </section>
        </div>
      )}
    </Drawer>
  );
};
