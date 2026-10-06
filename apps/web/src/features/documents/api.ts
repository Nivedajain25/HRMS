import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import type { EmployeeRef } from '@stencil/types';
import { del, get, getPaged, post, upload } from '@/lib/api';
import { apiDateKey, toDateKey } from '@/lib/utils';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type LibraryScope = 'me' | 'team' | 'all' | 'organization';

export interface UserName {
  _id: string;
  firstName: string;
  lastName: string;
}

export interface DocumentRecord {
  _id: string;
  title: string;
  category: string;
  description?: string;
  employeeId?: EmployeeRef | null;
  context: 'EMPLOYEE' | 'ORGANIZATION';
  originalName: string;
  mimeType: string;
  size: number;
  version: number;
  rootDocumentId?: string | null;
  isLatest: boolean;
  expiryDate?: string | null;
  confidential: boolean;
  verificationStatus: VerificationStatus;
  verifiedBy?: UserName | string | null;
  verifiedAt?: string | null;
  verificationNote?: string;
  uploadedBy?: UserName | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentRecord {
  url: string;
  versions: DocumentRecord[];
}

export interface ExpiringDocument extends Omit<DocumentRecord, 'employeeId'> {
  employeeId?: EmployeeRef | null;
  daysLeft: number;
  expired: boolean;
}

/** Server-side limits (magic-byte validated by the API). */
export const MAX_UPLOAD_MB = 10;
export const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx';
export const DOCUMENT_TYPES_LABEL = 'PDF, PNG, JPG, WebP, DOCX or XLSX';
const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export const isPreviewable = (mimeType?: string) => !!mimeType && PREVIEWABLE.has(mimeType);
export const fileUrl = (id: string) => `/files/${id}`;

/** `expired` (before today), `soon` (within `soonDays`), or null. */
export const expiryInfo = (expiry?: string | null, soonDays = 30) => {
  if (!expiry) return null;
  const key = apiDateKey(expiry);
  const today = toDateKey(new Date());
  const daysLeft = differenceInCalendarDays(parseISO(key), parseISO(today));
  if (key < today) return { state: 'expired' as const, daysLeft };
  if (key <= toDateKey(addDays(new Date(), soonDays))) return { state: 'soon' as const, daysLeft };
  return { state: 'valid' as const, daysLeft };
};

export const documentKeys = {
  all: ['documents'] as const,
  list: (q: object) => ['documents', 'list', q] as const,
  detail: (id: string) => ['documents', 'detail', id] as const,
  versions: (id: string) => ['documents', 'versions', id] as const,
  expiring: (q: object) => ['documents', 'expiring', q] as const,
};

export const useDocuments = (query: object, enabled = true) =>
  useQuery({
    queryKey: documentKeys.list(query),
    queryFn: () => getPaged<DocumentRecord>('/documents', query),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useDocument = (id: string | null) =>
  useQuery({ queryKey: documentKeys.detail(id ?? ''), queryFn: () => get<DocumentDetail>(`/documents/${id}`), enabled: !!id });

export const useDocumentVersions = (id: string | null) =>
  useQuery({ queryKey: documentKeys.versions(id ?? ''), queryFn: () => get<DocumentRecord[]>(`/documents/${id}/versions`), enabled: !!id });

export const useExpiringDocuments = (q: { days: number; scope?: LibraryScope }, enabled = true) =>
  useQuery({ queryKey: documentKeys.expiring(q), queryFn: () => get<ExpiringDocument[]>('/documents/expiring', q), enabled });

export interface UploadDocumentInput {
  file: File;
  fields: Record<string, string | undefined>;
}

export const useUploadDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, fields }: UploadDocumentInput) => upload<DocumentRecord>('/documents', file, fields),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
};

export const useVerifyDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: 'VERIFIED' | 'REJECTED'; note?: string }) =>
      post<DocumentRecord>(`/documents/${id}/verify`, { status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
};

export const useDeleteDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
};
