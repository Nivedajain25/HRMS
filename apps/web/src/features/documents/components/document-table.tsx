import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Download, Eye, History, Lock, MoreHorizontal, Trash2, Upload, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { DataTable, type DataTableProps } from '@/components/tables/data-table';
import { Badge, PersonCell } from '@/components/ui/display';
import { Dropdown } from '@/components/ui/overlay';
import { label } from '@/lib/i18n';
import { formatBytes, formatDate, fullName } from '@/lib/utils';
import { isPreviewable, type DocumentRecord } from '../api';
import { DocumentDetailDrawer } from './document-detail-drawer';
import { DocumentTypeIcon, ExpiryBadge, useDocumentActions, useDocumentPermissions } from './document-ui';
import { DocumentUploadDrawer } from './document-upload-drawer';

type TableProps = Omit<DataTableProps<DocumentRecord>, 'columns' | 'onRowClick' | 'getRowId'>;

export interface DocumentTableProps extends TableProps {
  showEmployee?: boolean;
  /** Controlled detail drawer (e.g. `?highlight=` deep links). */
  openId?: string | null;
  onOpenChange?: (id: string | null) => void;
}

export const DocumentTable = ({ showEmployee = true, openId, onOpenChange, ...table }: DocumentTableProps) => {
  const actions = useDocumentActions();
  const perms = useDocumentPermissions();
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const [versionOf, setVersionOf] = useState<DocumentRecord | null>(null);
  const currentOpen = openId !== undefined ? openId : localOpen;
  const setOpen = (id: string | null) => (onOpenChange ? onOpenChange(id) : setLocalOpen(id));

  const columns: ColumnDef<DocumentRecord, unknown>[] = [
      {
        id: 'title',
        header: 'Document',
        enableSorting: true,
        enableHiding: false,
        cell: ({ row }) => {
          const d = row.original;
          return (
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">
                <DocumentTypeIcon mimeType={d.mimeType} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium text-fg">
                  <span className="max-w-[16rem] truncate">{d.title}</span>
                  {d.confidential && <Lock className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-label="Confidential" />}
                  {d.version > 1 && <Badge className="px-1.5">v{d.version}</Badge>}
                </span>
                <span className="block max-w-[16rem] truncate text-xs text-muted">
                  {d.originalName} · {formatBytes(d.size)}
                </span>
              </span>
            </span>
          );
        },
      },
      ...(showEmployee
        ? [
            {
              id: 'employee',
              header: 'Belongs to',
              cell: ({ row }: { row: { original: DocumentRecord } }) =>
                row.original.employeeId ? (
                  <PersonCell name={fullName(row.original.employeeId)} subtitle={row.original.employeeId.employeeId} photo={row.original.employeeId.profilePhoto} />
                ) : (
                  <span className="text-muted">Company-wide</span>
                ),
            } satisfies ColumnDef<DocumentRecord, unknown>,
          ]
        : []),
      { id: 'category', header: 'Category', enableSorting: true, cell: ({ row }) => label(row.original.category) },
      {
        id: 'expiryDate',
        header: 'Expiry',
        enableSorting: true,
        cell: ({ row }) =>
          row.original.expiryDate ? (
            <span className="flex items-center gap-2">
              {formatDate(row.original.expiryDate)}
              <ExpiryBadge expiry={row.original.expiryDate} />
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      { id: 'verificationStatus', header: 'Status', enableSorting: true, cell: ({ row }) => <StatusBadge status={row.original.verificationStatus} /> },
      {
        id: 'createdAt',
        header: 'Uploaded',
        enableSorting: true,
        cell: ({ row }) => (
          <span>
            {formatDate(row.original.createdAt)}
            {row.original.uploadedBy && <span className="block text-xs text-muted">{fullName(row.original.uploadedBy)}</span>}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => {
          const d = row.original;
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <Dropdown
                label={`Actions for ${d.title}`}
                trigger={
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                    <MoreHorizontal className="h-4 w-4" />
                  </span>
                }
                items={[
                  { label: 'Preview', icon: <Eye className="h-4 w-4" />, onSelect: () => actions.preview(d), hidden: !isPreviewable(d.mimeType) },
                  { label: 'Download', icon: <Download className="h-4 w-4" />, onSelect: () => actions.download(d) },
                  { label: 'Upload new version', icon: <Upload className="h-4 w-4" />, onSelect: () => setVersionOf(d), hidden: !perms.canNewVersion(d) },
                  { label: 'Version history', icon: <History className="h-4 w-4" />, onSelect: () => setOpen(d._id) },
                  { label: 'Verify', icon: <CheckCircle2 className="h-4 w-4" />, onSelect: () => actions.verify(d), hidden: !perms.canVerify(d) || d.verificationStatus === 'VERIFIED' },
                  { label: 'Reject', icon: <XCircle className="h-4 w-4" />, onSelect: () => actions.reject(d), hidden: !perms.canVerify(d) || d.verificationStatus === 'REJECTED' },
                  { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => actions.remove(d), hidden: !perms.canDelete(d) },
                ]}
              />
            </div>
          );
        },
      },
  ];

  return (
    <>
      <DataTable {...table} columns={columns} getRowId={(d) => d._id} onRowClick={(d) => setOpen(d._id)} />
      <DocumentDetailDrawer
        id={currentOpen}
        onClose={() => setOpen(null)}
        onNewVersion={(d) => {
          setOpen(null);
          setVersionOf(d);
        }}
      />
      <DocumentUploadDrawer open={!!versionOf} parent={versionOf} onClose={() => setVersionOf(null)} />
    </>
  );
};
