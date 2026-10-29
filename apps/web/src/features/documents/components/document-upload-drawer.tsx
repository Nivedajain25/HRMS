import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Building2, History, UserRound } from 'lucide-react';
import { DOCUMENT_CATEGORIES, DOCUMENT_TYPE_INFO, documentUploadSchema, type DocumentType } from '@stencil/shared';
import { EmployeePicker, FileUpload } from '@/components/common/controls';
import { applyServerErrors, FormError, FormField, FormGrid } from '@/components/forms/form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input';
import { Drawer } from '@/components/ui/overlay';
import { toApiError } from '@/lib/api';
import { label } from '@/lib/i18n';
import { cn, fullName } from '@/lib/utils';
import { usePermissions } from '@/store/auth';
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES_LABEL, MAX_UPLOAD_MB, useUploadDocument, type DocumentRecord } from '../api';

type Values = z.input<typeof documentUploadSchema>;
type Owner = 'employee' | 'organization';

export interface DocumentUploadDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Upload a new version of this document. */
  parent?: DocumentRecord | null;
  /** Lock the upload to this employee (profile tab). */
  employee?: { id: string; name: string } | null;
  /** Start as a company-wide document (policies tab). */
  organization?: boolean;
  /** Upload one of the fixed employee documents (title and category are set for you). */
  docType?: DocumentType | null;
}

const categoryOptions = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: label(c) }));

export const DocumentUploadDrawer = ({ open, onClose, parent, employee, organization, docType: docTypeProp }: DocumentUploadDrawerProps) => {
  const docType = parent?.docType ?? docTypeProp ?? null;
  const typeInfo = docType ? DOCUMENT_TYPE_INFO[docType] : null;
  const { can, user } = usePermissions();
  const isAdmin = can('document:create');
  const uploadDoc = useUploadDocument();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [owner, setOwner] = useState<Owner>('employee');

  const form = useForm<Values, unknown, z.output<typeof documentUploadSchema>>({ resolver: zodResolver(documentUploadSchema) });
  const { register, control, handleSubmit, reset, formState, setError } = form;
  const errors = formState.errors;

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setFileError(null);
    setServerError(null);
    const orgDefault = !parent && !employee && !!organization && isAdmin;
    setOwner(orgDefault ? 'organization' : 'employee');
    reset({
      title: parent?.title ?? typeInfo?.label ?? '',
      category: (parent?.category as Values['category']) ?? typeInfo?.category ?? (organization ? 'POLICY' : 'OTHER'),
      employeeId: employee?.id ?? (isAdmin ? '' : (user?.employeeId ?? '')),
      description: parent?.description ?? '',
      expiryDate: '',
      confidential: parent?.confidential ?? false,
    });
  }, [open, parent, employee, organization, typeInfo, isAdmin, user?.employeeId, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (!file) {
      setFileError('Choose a file to upload');
      return;
    }
    let employeeId: string | undefined;
    if (parent) employeeId = undefined;
    else if (employee) employeeId = employee.id;
    else if (!isAdmin) employeeId = user?.employeeId ?? undefined;
    else if (owner === 'employee') {
      employeeId = values.employeeId || undefined;
      if (!employeeId) {
        setError('employeeId', { message: 'Select the employee this document belongs to' });
        return;
      }
    }
    try {
      const res = await uploadDoc.mutateAsync({
        file,
        fields: {
          title: values.title,
          category: values.category,
          docType: docType ?? undefined,
          employeeId,
          description: values.description || undefined,
          expiryDate: values.expiryDate || undefined,
          parentDocumentId: parent?._id,
          confidential: String(values.confidential ?? false),
        },
      });
      toast.success(res.data.version > 1 ? `${res.data.title} replaced (version ${res.data.version})` : `${res.data.title} uploaded`);
      onClose();
    } catch (err) {
      setServerError(applyServerErrors(toApiError(err), setError, ['title', 'category', 'employeeId', 'description', 'expiryDate']));
    }
  });

  const showOwnerChoice = isAdmin && !parent && !employee && !docType;
  const lockedOwnerLabel = parent
    ? parent.employeeId
      ? fullName(parent.employeeId)
      : 'Company-wide'
    : employee
      ? employee.name
      : !isAdmin
        ? 'You'
        : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={typeInfo ? `${parent ? 'Replace' : 'Upload'} ${typeInfo.label}` : parent ? 'Upload new version' : 'Upload document'}
      description={parent ? `Replaces v${parent.version} of "${parent.title}". Earlier versions stay in the history.` : 'Files are stored privately and only visible to people with access.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={formState.isSubmitting}>
            {parent ? (typeInfo ? 'Replace' : 'Upload version') : 'Upload'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <FormError error={serverError} />

        <FormField label="File" required error={fileError ?? undefined} hint={`${DOCUMENT_TYPES_LABEL} · max ${MAX_UPLOAD_MB} MB. The real file type is verified on upload.`}>
          {({ id }) => (
            <FileUpload
              id={id}
              file={file}
              accept={DOCUMENT_ACCEPT}
              maxMb={MAX_UPLOAD_MB}
              hint={`${DOCUMENT_TYPES_LABEL} · max ${MAX_UPLOAD_MB} MB`}
              onFile={(f) => {
                setFile(f);
                setFileError(null);
              }}
            />
          )}
        </FormField>

        {showOwnerChoice && (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium text-fg">Belongs to</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  { key: 'employee', title: 'An employee', desc: 'Personal record (ID, contract, certificate…)', icon: UserRound },
                  { key: 'organization', title: 'Company-wide', desc: 'Policy or handbook visible to everyone', icon: Building2 },
                ] as const
              ).map((o) => (
                <label
                  key={o.key}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                    owner === o.key ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-line-strong hover:bg-surface-2',
                  )}
                >
                  <input type="radio" name="doc-owner" className="mt-0.5 accent-brand-600" checked={owner === o.key} onChange={() => setOwner(o.key)} />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium text-fg">
                      <o.icon className="h-4 w-4" aria-hidden /> {o.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {showOwnerChoice && owner === 'employee' && (
          <FormField label="Employee" required error={errors.employeeId}>
            {({ id, invalid }) => (
              <Controller
                control={control}
                name="employeeId"
                render={({ field }) => <EmployeePicker id={id} invalid={invalid} value={(field.value as string | undefined) || null} onChange={(v) => field.onChange(typeof v === 'string' ? v : '')} />}
              />
            )}
          </FormField>
        )}

        {lockedOwnerLabel && (
          <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
            {parent ? <History className="h-4 w-4 text-muted" aria-hidden /> : <UserRound className="h-4 w-4 text-muted" aria-hidden />}
            Belongs to <span className="font-medium text-fg">{lockedOwnerLabel}</span>
          </p>
        )}

        {!typeInfo && (
          <FormGrid>
            <FormField label="Title" required error={errors.title} className="sm:col-span-2">
              {({ id, invalid }) => <Input id={id} aria-invalid={invalid} maxLength={150} placeholder="e.g. Passport" {...register('title')} />}
            </FormField>
            <FormField label="Category" required error={errors.category}>
              {({ id, invalid }) => <Select id={id} aria-invalid={invalid} options={categoryOptions} {...register('category')} />}
            </FormField>
            <FormField label="Expiry date" error={errors.expiryDate} hint="Owners and HR are reminded before it expires.">
              {({ id, invalid }) => <Input id={id} type="date" aria-invalid={invalid} {...register('expiryDate')} />}
            </FormField>
          </FormGrid>
        )}
        <FormField label="Description" error={errors.description}>
          {({ id, invalid }) => <Textarea id={id} rows={3} maxLength={500} aria-invalid={invalid} {...register('description')} />}
        </FormField>
        <Checkbox
          label="Confidential"
          description="Hidden from managers; only the employee and document administrators can view it."
          {...register('confidential')}
        />
      </form>
    </Drawer>
  );
};
