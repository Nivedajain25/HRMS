import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeeCreateInput, EmployeeUpdateInput } from '@stencil/shared';
import { del, get, getPaged, patch, post } from '@/lib/api';

export interface NamedRef {
  _id: string;
  name: string;
  code?: string;
}

export interface EmployeeSummary {
  _id: string;
  employeeId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  profilePhoto?: string | null;
  workEmail: string;
  phone?: string;
  joiningDate: string;
  employmentType: string;
  employmentStatus: string;
  departmentId?: NamedRef | null;
  designationId?: (NamedRef & { level?: number }) | null;
  locationId?: (NamedRef & { city?: string }) | null;
  managerId?: { _id: string; employeeId: string; firstName: string; lastName: string; profilePhoto?: string | null } | null;
  userId?: string | { _id: string; email: string; status: string; lastLoginAt?: string } | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  gender?: string;
  dateOfBirth?: string;
  weddingAnniversary?: string | null;
  bloodGroup?: string;
  maritalStatus?: string;
  personalEmail?: string;
  alternatePhone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  confirmationDate?: string | null;
  exitDate?: string | null;
  probationPeriodDays?: number;
  noticePeriodDays?: number;
  shiftId?: (NamedRef & { startTime: string; endTime: string }) | null;
  bank?: { bankName?: string; accountHolderName?: string; ifsc?: string; branch?: string; accountNumber?: string; accountNumberMasked?: string } | null;
  identity?: Record<string, string | undefined>;
  emergencyContact?: { contactName?: string; relationship?: string; phone?: string; address?: string };
  sensitiveVisible: boolean;
  directReportCount: number;
  createdAt: string;
}

export interface HistoryEntry {
  _id: string;
  field: string;
  oldLabel?: string | null;
  newLabel?: string | null;
  effectiveDate: string;
  reason?: string;
  changedBy?: { firstName: string; lastName: string } | null;
  createdAt: string;
}

export const employeeKeys = {
  all: ['employees'] as const,
  list: (q: object) => ['employees', 'list', q] as const,
  detail: (id: string) => ['employees', 'detail', id] as const,
  history: (id: string) => ['employees', 'history', id] as const,
};

export const useEmployees = (query: object) =>
  useQuery({ queryKey: employeeKeys.list(query), queryFn: () => getPaged<EmployeeSummary>('/employees', query), placeholderData: keepPreviousData });

export const useEmployee = (id: string | undefined) =>
  useQuery({ queryKey: employeeKeys.detail(id ?? ''), queryFn: () => get<EmployeeDetail>(`/employees/${id}`), enabled: !!id });

export const useMyEmployee = () => useQuery({ queryKey: ['employees', 'me'], queryFn: () => get<EmployeeDetail | null>('/employees/me') });

export interface Teammate {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  workEmail: string;
  departmentId?: NamedRef | null;
  designationId?: NamedRef | null;
}

/** My manager and the colleagues who report to the same person. */
export const useTeammates = () =>
  useQuery({ queryKey: ['employees', 'teammates'], queryFn: () => get<{ manager: Teammate | null; teammates: Teammate[] }>('/employees/teammates') });

export const useEmployeeHistory = (id: string) =>
  useQuery({ queryKey: employeeKeys.history(id), queryFn: () => get<HistoryEntry[]>(`/employees/${id}/history`) });

export const useSaveEmployee = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeeCreateInput | EmployeeUpdateInput) =>
      id ? patch<EmployeeDetail>(`/employees/${id}`, input) : post<EmployeeDetail>('/employees', input),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: employeeKeys.all }),
  });
};

export const useArchiveEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/employees/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: employeeKeys.all }),
  });
};

/* ---------------------------- Master data ---------------------------- */

export interface MasterRecord {
  _id: string;
  name: string;
  code?: string;
  status?: string;
  employeeCount?: number;
  [key: string]: unknown;
}

export const useAllOf = <T = MasterRecord>(resource: 'departments' | 'designations' | 'locations' | 'shifts' | 'leave-types') =>
  useQuery({ queryKey: [resource, 'all'], queryFn: () => get<T[]>(`/${resource}/all`), staleTime: 5 * 60_000 });

export const toOptions = (rows: { _id: string; name: string; code?: string }[] | undefined) =>
  (rows ?? []).map((r) => ({ value: r._id, label: r.code ? `${r.name} (${r.code})` : r.name }));
