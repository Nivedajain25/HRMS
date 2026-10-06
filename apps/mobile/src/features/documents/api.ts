import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeeRef } from '@stencil/types';
import { get, upload, type UploadFile } from '@/lib/api';
import { toDateKey } from '@/lib/time';
import { useInfiniteList } from '@/features/profile/kit/infinite';

/* Same shapes as the web `features/documents/api.ts`. */

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type LibraryScope = 'me' | 'organization';

interface UserName {
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

export const MAX_UPLOAD_MB = 10;

export const documentKeys = {
  all: ['documents'] as const,
  list: (q: object) => ['documents', 'list', q] as const,
  detail: (id: string) => ['documents', 'detail', id] as const,
};

export const useDocumentLibrary = (scope: LibraryScope, category: string | undefined, enabled = true) => {
  const query = { scope, category, sortBy: 'createdAt', sortOrder: 'desc' } as const;
  return useInfiniteList<DocumentRecord>(documentKeys.list(query), '/documents', query, { enabled });
};

export const useDocument = (id: string | null) =>
  useQuery({ queryKey: documentKeys.detail(id ?? ''), queryFn: () => get<DocumentDetail>(`/documents/${id}`), enabled: !!id });

export interface UploadDocumentFields {
  title: string;
  category: string;
  employeeId?: string;
  description?: string;
  expiryDate?: string;
  confidential: boolean;
}

export const useUploadDocument = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, fields }: { file: UploadFile; fields: UploadDocumentFields }) =>
      upload<DocumentRecord>('/documents', file, {
        title: fields.title,
        category: fields.category,
        employeeId: fields.employeeId,
        description: fields.description || undefined,
        expiryDate: fields.expiryDate || undefined,
        confidential: String(fields.confidential),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }),
  });
};

/** `expired` (before today), `soon` (within 30 days) or `valid`; null without an expiry date. */
export const expiryInfo = (expiry: string | null | undefined, today = toDateKey(new Date())) => {
  if (!expiry) return null;
  const key = expiry.slice(0, 10);
  const [y, m, d] = key.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const daysLeft = Math.round((Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1)) / 86_400_000);
  if (daysLeft < 0) return { state: 'expired' as const, daysLeft };
  if (daysLeft <= 30) return { state: 'soon' as const, daysLeft };
  return { state: 'valid' as const, daysLeft };
};
