import { useMemo, useState } from 'react';
import { Eye, FileUp, Lock, RefreshCw } from 'lucide-react';
import type { DocumentType } from '@stencil/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/display';
import { cn, formatDate } from '@/lib/utils';
import { useDocumentChecklist, type ChecklistItem, type DocumentRecord } from '../api';
import { DocumentDetailDrawer } from './document-detail-drawer';
import { DocumentTypeIcon, useDocumentPermissions } from './document-ui';
import { DocumentUploadDrawer } from './document-upload-drawer';

export interface DocumentChecklistProps {
  /** The employee whose documents are shown; omit for your own. */
  employeeId?: string | null;
  /** Uploads for the employee are locked to this owner. */
  owner: { id: string; name: string };
}

const ChecklistRow = ({
  item,
  canUpload,
  canReplace,
  onUpload,
  onView,
  onReplace,
}: {
  item: ChecklistItem;
  canUpload: boolean;
  canReplace: boolean;
  onUpload: () => void;
  onView: (d: DocumentRecord) => void;
  onReplace: (d: DocumentRecord) => void;
}) => {
  const d = item.document;
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            item.status === 'MISSING' ? 'border border-dashed border-line-strong text-muted' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
          )}
        >
          {item.status === 'RESTRICTED' ? <Lock className="h-4 w-4" aria-hidden /> : <DocumentTypeIcon mimeType={d?.mimeType} />}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            {item.label}
            {item.status === 'MISSING' ? (
              <Badge tone="amber" dot>
                Missing
              </Badge>
            ) : item.status === 'RESTRICTED' ? (
              <Badge tone="purple">Uploaded · confidential</Badge>
            ) : (
              d && <StatusBadge status={d.verificationStatus} />
            )}
          </p>
          <p className="truncate text-xs text-muted">
            {d
              ? `${d.originalName} · ${formatDate(d.createdAt)}${d.version > 1 ? ` · v${d.version}` : ''}`
              : item.status === 'RESTRICTED'
                ? 'Only the employee and document administrators can view it'
                : 'Not uploaded yet'}
          </p>
          {d?.verificationStatus === 'REJECTED' && d.verificationNote && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">Rejected: {d.verificationNote}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:justify-end">
        {d ? (
          <>
            <Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => onView(d)} aria-label={`View ${item.label}`}>
              View
            </Button>
            {canReplace && (
              <Button variant="outline" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => onReplace(d)} aria-label={`Replace ${item.label}`}>
                Replace
              </Button>
            )}
          </>
        ) : (
          item.status === 'MISSING' &&
          canUpload && (
            <Button size="sm" icon={<FileUp className="h-4 w-4" />} onClick={onUpload} aria-label={`Upload ${item.label}`}>
              Upload
            </Button>
          )
        )}
      </div>
    </li>
  );
};

/** Aadhaar, PAN, marks cards and degree: one row each with upload / view / replace. */
export const DocumentChecklist = ({ employeeId, owner }: DocumentChecklistProps) => {
  const checklist = useDocumentChecklist(employeeId);
  const perms = useDocumentPermissions();
  const [uploadType, setUploadType] = useState<DocumentType | null>(null);
  const [replacing, setReplacing] = useState<DocumentRecord | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const canUpload = perms.canUploadFor(owner.id);
  const items = useMemo(() => checklist.data ?? [], [checklist.data]);
  const done = items.filter((i) => i.status !== 'MISSING').length;

  return (
    <Card className="mb-4 overflow-hidden">
      <CardHeader
        title="Required documents"
        description={checklist.data ? (done === items.length ? 'All documents uploaded.' : `${done} of ${items.length} uploaded`) : 'ID proofs and education certificates'}
      />
      {checklist.isLoading ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : checklist.error ? (
        <ErrorState message={checklist.error.message} onRetry={() => checklist.refetch()} className="py-6" />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <ChecklistRow
              key={item.type}
              item={item}
              canUpload={canUpload}
              canReplace={!!item.document && perms.canNewVersion(item.document)}
              onUpload={() => setUploadType(item.type)}
              onView={(d) => setViewId(d._id)}
              onReplace={setReplacing}
            />
          ))}
        </ul>
      )}
      <DocumentUploadDrawer open={!!uploadType} docType={uploadType} employee={owner} onClose={() => setUploadType(null)} />
      <DocumentUploadDrawer open={!!replacing} parent={replacing} onClose={() => setReplacing(null)} />
      <DocumentDetailDrawer
        id={viewId}
        onClose={() => setViewId(null)}
        onNewVersion={(d) => {
          setViewId(null);
          setReplacing(d);
        }}
      />
    </Card>
  );
};
