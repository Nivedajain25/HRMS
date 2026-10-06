import { useQuery } from '@tanstack/react-query';
import { get, getPaged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInfiniteList } from '@/features/profile/kit/infinite';
import type { EmployeeDetail, EmployeeSummary } from '@/features/profile/api';

export const teamKeys = {
  list: (q: object) => ['employees', 'list', q] as const,
  detail: (id: string) => ['employees', 'detail', id] as const,
};

/** Direct and indirect reports (`scope=team`), alphabetical. */
export const useMyTeam = (search: string) => {
  const { isManager } = useAuth();
  const query = { scope: 'team', search: search || undefined, sortBy: 'firstName', sortOrder: 'asc' } as const;
  return useInfiniteList<EmployeeSummary>(teamKeys.list(query), '/employees', query, { enabled: isManager, limit: 25 });
};

export interface Teammate {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
  workEmail: string;
  departmentId?: { _id: string; name: string } | null;
  designationId?: { _id: string; name: string } | null;
}

/** For employees: their reporting manager and the colleagues who share that manager. */
export const useTeammates = (enabled: boolean) =>
  useQuery({
    queryKey: ['employees', 'teammates'],
    queryFn: () => get<{ manager: Teammate | null; teammates: Teammate[] }>('/employees/teammates'),
    enabled,
  });

/** Everyone in the organization (HR / super admin), alphabetical, optionally one department. */
export const useAllEmployees = (search: string, department: string | null, enabled: boolean) => {
  const query = { search: search || undefined, department: department || undefined, sortBy: 'firstName', sortOrder: 'asc' } as const;
  return useInfiniteList<EmployeeSummary>(teamKeys.list({ all: true, ...query }), '/employees', query, { enabled, limit: 50 });
};

export const useDepartments = (enabled: boolean) =>
  useQuery({
    queryKey: ['departments', 'all'],
    queryFn: async () => (await getPaged<{ _id: string; name: string }>('/departments', { limit: 100 })).data,
    enabled,
    staleTime: 10 * 60_000,
  });

export interface MonthSummary {
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  workFromHome: number;
  totalWorkingHours: number;
  lateMinutes: number;
}

/** One employee's attendance totals for the current month. */
export const useEmployeeMonth = (employeeId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['attendance', 'summary', 'employee', employeeId],
    queryFn: async () => (await get<{ employees: MonthSummary[] }>('/attendance/summary', { employeeId })).employees[0] ?? null,
    enabled: enabled && !!employeeId,
  });

export interface AttendanceDay {
  _id: string;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  workingMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  workMode: 'OFFICE' | 'REMOTE';
  checkInLocation?: {
    latitude?: number;
    longitude?: number;
    accuracy?: number | null;
    address?: string | null;
    withinOffice?: boolean | null;
    distanceMeters?: number | null;
    officeName?: string | null;
  } | null;
  checkInPhotoId?: string | null;
}

/** One employee's latest attendance days (with clock-in selfie and location). */
export const useEmployeeDays = (employeeId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['attendance', 'list', 'employee', employeeId],
    queryFn: async () => (await getPaged<AttendanceDay>('/attendance', { employeeId, limit: 7, sortBy: 'date', sortOrder: 'desc' })).data,
    enabled: enabled && !!employeeId,
  });

/** A colleague's profile; the API decides which fields are visible (IDOR-protected). */
export const useTeamMember = (id: string | undefined) =>
  useQuery({ queryKey: teamKeys.detail(id ?? ''), queryFn: () => get<EmployeeDetail>(`/employees/${id}`), enabled: !!id });
