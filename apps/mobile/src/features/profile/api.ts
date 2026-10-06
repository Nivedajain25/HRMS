import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { selfProfileUpdateSchema } from '@stencil/shared';
import { get, patch, upload, type UploadFile } from '@/lib/api';
import { reloadUser, useAuth } from '@/lib/auth';

/* Same shapes as the web `features/employees/api.ts`. */

export interface NamedRef {
  _id: string;
  name: string;
  code?: string;
}

export interface PersonRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
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
  managerId?: PersonRef | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  gender?: string;
  dateOfBirth?: string;
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
  bank?: {
    bankName?: string;
    accountHolderName?: string;
    ifsc?: string;
    branch?: string;
    accountNumber?: string;
    accountNumberMasked?: string;
  } | null;
  identity?: Record<string, string | undefined>;
  emergencyContact?: { contactName?: string; relationship?: string; phone?: string; address?: string };
  sensitiveVisible?: boolean;
  directReportCount?: number;
  createdAt?: string;
}

export type SelfProfileInput = z.input<typeof selfProfileUpdateSchema>;

export const profileKeys = {
  me: ['employees', 'me'] as const,
};

/** My employee record (`null` when the account is not linked to an employee). */
export const useMyEmployee = () => {
  const { hasEmployee } = useAuth();
  return useQuery({ queryKey: profileKeys.me, queryFn: () => get<EmployeeDetail | null>('/employees/me'), enabled: hasEmployee });
};

export const useUpdateMyProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SelfProfileInput) => patch<EmployeeDetail>('/employees/me', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
};

/** Uploads a new profile photo and refreshes the signed-in user (avatar). */
export const useUploadPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, file }: { employeeId: string; file: UploadFile }) => upload<unknown>(`/employees/${employeeId}/photo`, file),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['employees'] });
      await reloadUser().catch(() => undefined);
    },
  });
};
