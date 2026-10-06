import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Ban, Banknote, CheckCircle2, Clock, Download, Eye, FileText, Pencil, Send, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { DescriptionList, ErrorState, PersonCell, Skeleton } from '@/components/ui/display';
import { Drawer } from '@/components/ui/overlay';
import { downloadFile, fetchObjectUrl, openFile, toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, formatBytes, formatDate, formatDateTime, formatMoney, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { useExpense, type ApprovalStep, type ExpenseDetail, type ReceiptRef } from '../api';
import { useExpenseActions } from './expense-actions';

const APPROVER_LABEL: Record<ApprovalStep['approverType'], string> = { MANAGER: 'Reporting manager', HR: 'HR', FINANCE: 'Finance', PAYROLL: 'Payroll' };

const ReceiptImage = ({ url, alt }: { url: string; alt: string }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetchObjectUrl(`${url}?inline=1`)
      .then((u) => {
        objectUrl = u;
        if (!revoked) setSrc(u);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  if (failed) return null;
  if (!src) return <Skeleton className="h-48" />;
  return <img src={src} alt={alt} className="max-h-72 w-full rounded-lg border border-line bg-surface-2 object-contain" />;
};

const Receipt = ({ receipt, url }: { receipt: ReceiptRef; url: string | null }) => {
  const isImage = receipt.mimeType.startsWith('image/');
  const previewable = isImage || receipt.mimeType === 'application/pdf';
  const fail = (err: unknown) => toast.error(toApiError(err).message);
  return (
    <div className="space-y-3">
      {isImage && url && <ReceiptImage url={url} alt={`Receipt ${receipt.originalName}`} />}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          <span className="truncate font-medium">{receipt.originalName}</span>
          <span className="shrink-0 text-muted">{formatBytes(receipt.size)}</span>
        </span>
        <span className="flex gap-1">
          {previewable && (
            <Button variant="ghost" size="icon-sm" aria-label="Preview receipt" onClick={() => void openFile(`/files/${receipt._id}`).catch(fail)}>
              <Eye className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Download receipt" onClick={() => void downloadFile(`/files/${receipt._id}`, undefined, receipt.originalName).catch(fail)}>
            <Download className="h-4 w-4" />
          </Button>
        </span>
      </div>
    </div>
  );
};

const ApprovalTrail = ({ e }: { e: ExpenseDetail }) => {
  const steps = e.approvalSteps ?? [];
  const submitted = e.submittedAt;
  if (!steps.length && !submitted) return <p className="text-sm text-muted">Not submitted yet.</p>;
  const pending = e.status === 'SUBMITTED' || e.status === 'PENDING_APPROVAL';
  return (
    <ol className="relative space-y-5 border-l border-line pl-5">
      {submitted && (
        <li className="relative">
          <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-600" aria-hidden />
          <p className="text-sm font-medium text-fg">Submitted</p>
          <p className="text-xs text-muted">
            {formatDateTime(submitted)} · {fullName(e.employeeId)}
          </p>
        </li>
      )}
      {steps.map((s, i) => {
        const current = pending && i === e.currentStep && s.status === 'PENDING';
        const dot = s.status === 'APPROVED' ? 'bg-emerald-500' : s.status === 'REJECTED' ? 'bg-red-500' : current ? 'bg-amber-500' : 'bg-line-strong';
        return (
          <li key={i} className="relative">
            <span className={cn('absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface', dot)} aria-hidden />
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {APPROVER_LABEL[s.approverType] ?? label(s.approverType)}
              {current ? (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-700 dark:text-amber-300">
                  <Clock className="h-3.5 w-3.5" aria-hidden /> Awaiting decision
                </span>
              ) : (
                <StatusBadge status={s.status} />
              )}
            </p>
            {(s.actedByName || s.actedAt) && (
              <p className="text-xs text-muted">
                {[s.actedByName, s.actedAt ? formatDateTime(s.actedAt) : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {s.comment && <p className="mt-1 text-sm text-fg-2">“{s.comment}”</p>}
          </li>
        );
      })}
      {e.status === 'PAID' && (
        <li className="relative">
          <span className="absolute top-1.5 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-teal-500" aria-hidden />
          <p className="text-sm font-medium text-fg">Paid</p>
          <p className="text-xs text-muted">{formatDate(e.paidAt)}</p>
        </li>
      )}
    </ol>
  );
};

export const ExpenseDetailDrawer = ({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (e: ExpenseDetail) => void }) => {
  const expense = useExpense(id);
  const actions = useExpenseActions();
  const { can } = usePermissions();
  const e = expense.data;
  const p = e?.permissions;
  const paidBy = e?.paidBy && typeof e.paidBy === 'object' ? fullName(e.paidBy) : null;

  return (
    <>
      <Drawer
        open={!!id}
        onClose={onClose}
        title={e ? e.expenseNumber : 'Expense'}
        description={e ? `${label(e.category)} · ${formatDate(e.date)}` : undefined}
        footer={
          e && p && (p.canEdit || p.canCancel || p.canApprove || p.canPay) ? (
            <>
              {p.canCancel && (
                <Button variant="ghost" className="mr-auto text-red-600 dark:text-red-400" icon={<Ban className="h-4 w-4" />} onClick={() => void actions.cancel(e)} disabled={actions.busy}>
                  Cancel claim
                </Button>
              )}
              {p.canEdit && (
                <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(e)}>
                  Edit
                </Button>
              )}
              {p.canEdit && (
                <Button icon={<Send className="h-4 w-4" />} onClick={() => void actions.submit(e)} loading={actions.busy}>
                  Submit
                </Button>
              )}
              {p.canApprove && can('expense:reject') && (
                <Button variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={() => void actions.reject(e)} disabled={actions.busy}>
                  Reject
                </Button>
              )}
              {p.canApprove && (
                <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void actions.approve(e)} loading={actions.busy}>
                  Approve
                </Button>
              )}
              {p.canPay && (
                <Button variant="success" icon={<Banknote className="h-4 w-4" />} onClick={() => actions.pay(e)}>
                  Mark paid
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {expense.isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : expense.error || !e ? (
          <ErrorState message={expense.error?.message} onRetry={() => expense.refetch()} />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-surface-2 p-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-muted uppercase">Amount</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">{formatMoney(e.amount, e.currency)}</p>
              </div>
              <StatusBadge status={e.status} />
            </div>

            {e.status === 'REJECTED' && e.rejectionReason && (
              <div role="note" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                <span className="font-medium">Rejected:</span> {e.rejectionReason}
              </div>
            )}

            {e.status === 'PAID' && (
              <div role="note" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-200">
                <span className="font-medium">Paid on {formatDate(e.paidAt)}</span>
                {paidBy ? ` by ${paidBy}` : ''}
                {e.paymentReference ? ` · Ref ${e.paymentReference}` : ''}
              </div>
            )}

            <DescriptionList
              items={[
                { label: 'Employee', value: <PersonCell name={fullName(e.employeeId)} subtitle={e.employeeId.employeeId} photo={e.employeeId.profilePhoto} /> },
                { label: 'Category', value: label(e.category) },
                { label: 'Expense date', value: formatDate(e.date) },
                { label: 'Merchant', value: e.merchant },
                { label: 'Project / cost center', value: e.project },
                { label: 'Submitted', value: e.submittedAt ? formatDateTime(e.submittedAt) : null },
              ]}
            />
            <div>
              <h3 className="text-xs font-medium text-muted">Description</h3>
              <p className="mt-1 text-sm whitespace-pre-line text-fg">{e.description}</p>
            </div>

            <section aria-labelledby="expense-receipt">
              <h3 id="expense-receipt" className="mb-2 text-sm font-semibold text-fg">
                Receipt
              </h3>
              {e.receiptFileId ? <Receipt receipt={e.receiptFileId} url={e.receiptUrl} /> : <p className="text-sm text-muted">No receipt attached.</p>}
            </section>

            <section aria-labelledby="expense-trail">
              <h3 id="expense-trail" className="mb-3 text-sm font-semibold text-fg">
                Approval trail
              </h3>
              <ApprovalTrail e={e} />
            </section>
          </div>
        )}
      </Drawer>
      {actions.element}
    </>
  );
};
