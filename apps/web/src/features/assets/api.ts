import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { EmployeeRef } from '@stencil/types';
import type { AssetStatus, assetAssignSchema, assetReturnSchema, assetSchema, assetStatusSchema } from '@stencil/shared';
import { del, get, getPaged, patch, post } from '@/lib/api';

export interface UserName {
  _id: string;
  firstName: string;
  lastName: string;
}

export interface AssetRecord {
  _id: string;
  assetTag: string;
  name: string;
  category: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  warrantyExpiry?: string | null;
  vendor?: string;
  locationId?: { _id: string; name: string; city?: string } | null;
  status: AssetStatus;
  condition: string;
  currentEmployeeId?: EmployeeRef | null;
  currentAssignmentId?: string | null;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AssetRef {
  _id: string;
  assetTag: string;
  name: string;
  category: string;
  serialNumber?: string;
  status: AssetStatus;
  brand?: string;
  model?: string;
  condition?: string;
}

export interface AssetAssignment<A = string | AssetRef> {
  _id: string;
  assetId: A;
  employeeId: EmployeeRef;
  assignedDate: string;
  expectedReturnDate?: string | null;
  returnedDate?: string | null;
  conditionAtAssignment?: string;
  conditionAtReturn?: string | null;
  notes?: string;
  returnNotes?: string;
  status: 'ACTIVE' | 'RETURNED';
  assignedBy?: UserName | null;
  returnedTo?: UserName | null;
  createdAt: string;
}

export interface StatusHistoryEntry {
  from?: string | null;
  to: string;
  note?: string;
  by?: string;
  at: string;
}

export interface AssetDetail extends AssetRecord {
  statusHistory: StatusHistoryEntry[];
  assignments: AssetAssignment<string>[];
}

export interface AssetSummary {
  total: number;
  totalValue: number;
  currency: string;
  byStatus: { status: AssetStatus; count: number; value: number }[];
  byCategory: { category: string; count: number; value: number }[];
}

export type AssetInput = z.input<typeof assetSchema>;
export type AssignInput = z.output<typeof assetAssignSchema>;
export type ReturnInput = z.output<typeof assetReturnSchema>;
export type StatusInput = z.output<typeof assetStatusSchema>;

export const assetKeys = {
  all: ['assets'] as const,
  list: (q: object) => ['assets', 'list', q] as const,
  detail: (id: string) => ['assets', 'detail', id] as const,
  summary: ['assets', 'summary'] as const,
  mine: ['assets', 'mine'] as const,
  assignments: (q: object) => ['assets', 'assignments', q] as const,
};

export const useAssets = (query: object, enabled = true) =>
  useQuery({ queryKey: assetKeys.list(query), queryFn: () => getPaged<AssetRecord>('/assets', query), placeholderData: keepPreviousData, enabled });

export const useAsset = (id: string | undefined) =>
  useQuery({ queryKey: assetKeys.detail(id ?? ''), queryFn: () => get<AssetDetail>(`/assets/${id}`), enabled: !!id });

export const useAssetSummary = (enabled = true) => useQuery({ queryKey: assetKeys.summary, queryFn: () => get<AssetSummary>('/assets/summary'), enabled });

export const useMyAssets = (enabled = true) =>
  useQuery({ queryKey: assetKeys.mine, queryFn: () => get<AssetAssignment<AssetRef>[]>('/assets/mine'), enabled });

export const useAssignments = (query: object, enabled = true) =>
  useQuery({
    queryKey: assetKeys.assignments(query),
    queryFn: () => getPaged<AssetAssignment<AssetRef>>('/assets/assignments', query),
    placeholderData: keepPreviousData,
    enabled,
  });

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: assetKeys.all });
};

export const useSaveAsset = (id?: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => (id ? patch<AssetDetail>(`/assets/${id}`, input) : post<AssetDetail>('/assets', input)),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useAssignAsset = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: AssignInput & { id: string }) => post<AssetDetail>(`/assets/${id}/assign`, input),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useReturnAsset = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: ReturnInput & { id: string }) => post<AssetDetail>(`/assets/${id}/return`, input),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useAssetStatus = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: StatusInput & { id: string }) => post<AssetDetail>(`/assets/${id}/status`, input),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useDeleteAsset = () => {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => del(`/assets/${id}`), onSuccess: invalidate });
};

/** Search available assets for the assign-from-profile picker. */
export const loadAvailableAssets = async (search: string) => {
  const res = await getPaged<AssetRecord>('/assets', { status: 'AVAILABLE', search: search || undefined, limit: 30, sortBy: 'assetTag', sortOrder: 'asc' });
  return res.data.map((a) => ({
    value: a._id,
    label: `${a.assetTag} · ${a.name}`,
    description: [a.brand, a.model, a.serialNumber ? `SN ${a.serialNumber}` : null].filter(Boolean).join(' · '),
  }));
};
