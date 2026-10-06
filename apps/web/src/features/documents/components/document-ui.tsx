import { useCallback } from 'react';
import { toast } from 'sonner';
import { FileImage, FileSpreadsheet, FileText, File as FileIcon } from 'lucide-react';
import { Badge } from '@/components/ui/display';
import { useConfirm } from '@/components/ui/overlay';
import { downloadFile, openFile, toApiError } from '@/lib/api';
import { usePermissions } from '@/store/auth';
import { expiryInfo, fileUrl, useDeleteDocument, useVerifyDocument, type DocumentRecord } from '../api';

const OWNER_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DocumentTypeIcon = ({ mimeType, className = 'h-4 w-4' }: { mimeType?: string; className?: string }) => {
  if (mimeType?.startsWith('image/')) return <FileImage className={className} aria-hidden />;
  if (mimeType?.includes('spreadsheet')) return <FileSpreadsheet className={className} aria-hidden />;
  if (mimeType === 'application/pdf' || mimeType?.includes('word')) return <FileText className={className} aria-hidden />;
  return <FileIcon className={className} aria-hidden />;
};

export const ExpiryBadge = ({ expiry }: { expiry?: string | null }) => {
  const info = expiryInfo(expiry);
  if (!info || info.state === 'valid') return null;
  if (info.state === 'expired') {
    return (
      <Badge tone="red" dot>
        Expired
      </Badge>
    );
  }
  return (
    <Badge tone="amber" dot>
      {info.daysLeft === 0 ? 'Expires today' : `Expires in ${info.daysLeft}d`}
    </Badge>
  );
};

/** Client-side mirror of the API rules (the API remains the source of truth). */
export const useDocumentPermissions = () => {
  const { can, user } = usePermissions();
  const isOwn = (d: DocumentRecord) => !!user?.employeeId && d.employeeId?._id === user.employeeId;
  return {
    canUploadFor: (employeeId: string | null) => (employeeId ? employeeId === user?.employeeId || can('document:create') : can('document:create')),
    canNewVersion: (d: DocumentRecord) => (d.employeeId ? isOwn(d) || can('document:create') : can('document:create')),
    canVerify: (d: DocumentRecord) => can('document:verify') && !isOwn(d),
    canDelete: (d: DocumentRecord) => {
      if (can('document:delete')) return true;
      const recent = Date.now() - new Date(d.createdAt).getTime() < OWNER_DELETE_WINDOW_MS;
      return !!user && d.uploadedBy?._id === user._id && recent && d.verificationStatus !== 'VERIFIED';
    },
  };
};

/** Preview / download / verify / reject / delete handlers with confirmations and toasts. */
export const useDocumentActions = () => {
  const confirm = useConfirm();
  const verify = useVerifyDocument();
  const remove = useDeleteDocument();

  const preview = useCallback(async (d: Pick<DocumentRecord, '_id'>) => {
    try {
      await openFile(fileUrl(d._id));
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  }, []);

  const download = useCallback(async (d: Pick<DocumentRecord, '_id' | 'originalName'>) => {
    try {
      await downloadFile(fileUrl(d._id), undefined, d.originalName);
    } catch (err) {
      toast.error(toApiError(err).message);
    }
  }, []);

  const approve = async (d: DocumentRecord) => {
    const { confirmed } = await confirm({
      title: `Verify "${d.title}"?`,
      message: 'Marks the document as checked and valid. The employee is notified.',
      confirmLabel: 'Verify',
      tone: 'primary',
    });
    if (!confirmed) return false;
    await verify.mutateAsync({ id: d._id, status: 'VERIFIED' });
    toast.success('Document verified');
    return true;
  };

  const reject = async (d: DocumentRecord) => {
    const { confirmed, reason } = await confirm({
      title: `Reject "${d.title}"?`,
      message: 'The employee is notified with your reason and can upload a corrected version.',
      confirmLabel: 'Reject',
      requireReason: true,
      reasonLabel: 'Reason for rejection',
    });
    if (!confirmed) return false;
    await verify.mutateAsync({ id: d._id, status: 'REJECTED', note: reason });
    toast.success('Document rejected');
    return true;
  };

  const destroy = async (d: DocumentRecord) => {
    const { confirmed } = await confirm({
      title: `Delete "${d.title}"${d.version > 1 ? ` (v${d.version})` : ''}?`,
      message:
        d.version > 1
          ? 'This version is removed from the library and the previous version becomes current. The action is recorded in the audit log.'
          : 'The document is removed from the library. The action is recorded in the audit log.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return false;
    await remove.mutateAsync(d._id);
    toast.success('Document deleted');
    return true;
  };

  /** Wraps an async action so API errors (already toasted globally) don't surface as unhandled rejections. */
  const safe =
    <A,>(fn: (arg: A) => Promise<unknown>) =>
    (arg: A) => {
      fn(arg).catch(() => undefined);
    };

  return {
    preview: safe(preview),
    download: safe(download),
    verify: safe(approve),
    reject: safe(reject),
    remove: (d: DocumentRecord, after?: () => void) => {
      destroy(d)
        .then((done) => done && after?.())
        .catch(() => undefined);
    },
    busy: verify.isPending || remove.isPending,
  };
};
