import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Pagination } from '@stencil/types';
import { get, patch, post } from '@/lib/api';

export const COMPLAINT_CATEGORIES = ['WORKPLACE', 'HARASSMENT', 'PAYROLL', 'MANAGER', 'FACILITIES', 'IT', 'OTHER'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export type ComplaintStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';

export const CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  WORKPLACE: 'Workplace',
  HARASSMENT: 'Harassment / behaviour',
  PAYROLL: 'Salary & payroll',
  MANAGER: 'Manager / team',
  FACILITIES: 'Facilities',
  IT: 'IT & systems',
  OTHER: 'Other',
};
export const STATUS_LABEL: Record<ComplaintStatus, string> = { OPEN: 'Open', IN_REVIEW: 'In review', RESOLVED: 'Resolved', CLOSED: 'Closed' };
export const STATUS_TONE = { OPEN: 'amber', IN_REVIEW: 'blue', RESOLVED: 'green', CLOSED: 'gray' } as const;

interface Person {
  _id: string;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  profilePhoto?: string | null;
  departmentId?: { name?: string } | null;
}
export interface ComplaintReply {
  _id: string;
  name: string;
  staff: boolean;
  message: string;
  status: ComplaintStatus | null;
  createdAt: string;
}
export interface Complaint {
  _id: string;
  number: string;
  raisedByName: string;
  employeeId?: Person | null;
  category: ComplaintCategory;
  subject: string;
  description: string;
  status: ComplaintStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}
export interface ComplaintDetail extends Complaint {
  replies: ComplaintReply[];
  canHandle: boolean;
  mine: boolean;
}

const KEY = ['complaints'] as const;

export const useComplaints = (params: { scope: 'me' | 'all'; status?: ComplaintStatus; search?: string; page: number }) =>
  useQuery({
    queryKey: [...KEY, 'list', params],
    queryFn: () => get<{ items: Complaint[]; pagination: Pagination; counts: Partial<Record<ComplaintStatus, number>> }>('/complaints', { ...params, limit: 20 }),
    placeholderData: keepPreviousData,
  });

export const useComplaint = (id: string) => useQuery({ queryKey: [...KEY, 'detail', id], queryFn: () => get<ComplaintDetail>(`/complaints/${id}`) });

export const useCreateComplaint = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { category: ComplaintCategory; subject: string; description: string }) => post<Complaint>('/complaints', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
};

export const useReplyComplaint = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => post<ComplaintDetail>(`/complaints/${id}/replies`, { message }),
    onSuccess: (res) => {
      qc.setQueryData([...KEY, 'detail', id], res.data);
      qc.invalidateQueries({ queryKey: [...KEY, 'list'] });
    },
  });
};

export const useComplaintStatus = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: ComplaintStatus; message?: string }) => patch<ComplaintDetail>(`/complaints/${id}/status`, body),
    onSuccess: (res) => {
      qc.setQueryData([...KEY, 'detail', id], res.data);
      qc.invalidateQueries({ queryKey: [...KEY, 'list'] });
    },
  });
};
