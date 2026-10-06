import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  EXIT_TYPES,
  OffboardingStatus,
  ONBOARDING_TASK_CATEGORIES,
  TASK_ASSIGNEE,
  TASK_STATUS,
  assetReturnSchema,
  offboardingAdvanceSchema,
  offboardingCreateSchema,
  onboardingStartSchema,
  onboardingTemplateSchema,
} from '@stencil/shared';
import { del, get, getPaged, patch, post } from '@/lib/api';

export type TaskStatus = (typeof TASK_STATUS)[number];
export type TaskAssignee = (typeof TASK_ASSIGNEE)[number];
export type TaskCategory = (typeof ONBOARDING_TASK_CATEGORIES)[number];
export type ExitType = (typeof EXIT_TYPES)[number];

export interface NamedRef {
  _id: string;
  name: string;
}

export interface PersonRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

export interface UserRef {
  _id: string;
  firstName: string;
  lastName: string;
}

/* ------------------------------ Onboarding ------------------------------ */

export interface OnboardingEmployee extends PersonRef {
  joiningDate?: string;
  workEmail?: string;
  /** Raw id on the checklist endpoint (not populated). */
  managerId?: string | null;
  departmentId?: NamedRef | null;
  designationId?: NamedRef | null;
}

export interface OnboardingTask {
  _id: string;
  title: string;
  description?: string | null;
  category: TaskCategory;
  assignee: TaskAssignee;
  dueDate?: string | null;
  required: boolean;
  status: TaskStatus;
  note?: string | null;
  completedAt?: string | null;
  completedBy?: UserRef | null;
}

export interface Onboarding {
  _id: string;
  employeeId: OnboardingEmployee | null;
  templateId?: NamedRef | null;
  startDate: string;
  status: TaskStatus;
  tasks: OnboardingTask[];
  progress: number;
  completedAt?: string | null;
  createdAt: string;
}

export interface TemplateTask {
  title: string;
  description?: string | null;
  category: TaskCategory;
  assignee: TaskAssignee;
  dueInDays: number;
  required: boolean;
}

export interface OnboardingTemplate {
  _id: string;
  name: string;
  description?: string | null;
  departmentId?: NamedRef | null;
  tasks: TemplateTask[];
  isDefault: boolean;
  createdAt: string;
}

export type OnboardingStartInput = z.input<typeof onboardingStartSchema>;
export type TemplateInput = z.output<typeof onboardingTemplateSchema>;

export const onboardingKeys = {
  all: ['onboarding'] as const,
  list: (q: object) => ['onboarding', 'list', q] as const,
  detail: (id: string) => ['onboarding', 'detail', id] as const,
  mine: (q: object) => ['onboarding', 'mine', q] as const,
  templates: (q: object) => ['onboarding', 'templates', 'list', q] as const,
  template: (id: string) => ['onboarding', 'templates', 'detail', id] as const,
  allTemplates: ['onboarding', 'templates', 'all'] as const,
};

export const useOnboardings = (query: object) =>
  useQuery({ queryKey: onboardingKeys.list(query), queryFn: () => getPaged<Onboarding>('/onboarding', query), placeholderData: keepPreviousData });

export const useOnboarding = (id: string | undefined) =>
  useQuery({ queryKey: onboardingKeys.detail(id ?? ''), queryFn: () => get<Onboarding>(`/onboarding/${id}`), enabled: !!id });

export const useStartOnboarding = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OnboardingStartInput) => post<Onboarding>('/onboarding', input),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: onboardingKeys.all }),
  });
};

export const useUpdateTask = (onboardingId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, status, note }: { taskId: string; status: TaskStatus; note?: string }) =>
      patch<Onboarding>(`/onboarding/${onboardingId}/tasks/${taskId}`, { status, note }),
    onSuccess: (res) => {
      qc.setQueryData(onboardingKeys.detail(onboardingId), res.data);
      void qc.invalidateQueries({ queryKey: ['onboarding', 'list'] });
      void qc.invalidateQueries({ queryKey: ['onboarding', 'mine'] });
    },
  });
};

export const useTemplates = (query: object, enabled = true) =>
  useQuery({
    queryKey: onboardingKeys.templates(query),
    queryFn: () => getPaged<OnboardingTemplate>('/onboarding/templates', query),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAllTemplates = (enabled = true) =>
  useQuery({ queryKey: onboardingKeys.allTemplates, queryFn: () => get<OnboardingTemplate[]>('/onboarding/templates/all'), enabled, staleTime: 60_000 });

export const useTemplate = (id: string | undefined) =>
  useQuery({ queryKey: onboardingKeys.template(id ?? ''), queryFn: () => get<OnboardingTemplate>(`/onboarding/templates/${id}`), enabled: !!id });

export const useSaveTemplate = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) =>
      id ? patch<OnboardingTemplate>(`/onboarding/templates/${id}`, input) : post<OnboardingTemplate>('/onboarding/templates', input),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', 'templates'] }),
  });
};

export const useArchiveTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/onboarding/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding', 'templates'] }),
  });
};

/* ------------------------------ Offboarding ----------------------------- */

export interface OffboardingEmployee extends PersonRef {
  workEmail?: string;
  departmentId?: NamedRef | null;
  designationId?: NamedRef | null;
  managerId?: string | null;
  employmentStatus?: string;
  joiningDate?: string;
  exitDate?: string | null;
}

export interface ClearanceItem {
  department: string;
  cleared: boolean;
  note?: string | null;
  by?: string | null;
  at?: string | null;
}

export interface TimelineEntry {
  status: OffboardingStatus;
  note?: string | null;
  /** User id (not populated by the API). */
  by?: string | null;
  at: string;
}

export interface ExitInterview {
  reasonForLeaving?: string | null;
  rating?: number | null;
  wouldRecommend?: boolean | null;
  feedback?: string | null;
  conductedAt?: string | null;
}

export interface PayrollRunRef {
  _id: string;
  month: number;
  year: number;
  status: string;
  periodStart?: string;
  periodEnd?: string;
  isOffCycle?: boolean;
}

export interface AssetAssignment {
  _id: string;
  assetId: { _id: string; assetTag: string; name: string; category: string; serialNumber?: string | null; status: string } | null;
  assignedDate: string;
  expectedReturnDate?: string | null;
  conditionAtAssignment?: string | null;
  notes?: string | null;
}

export interface Offboarding {
  _id: string;
  employeeId: OffboardingEmployee | null;
  exitType: ExitType;
  reason: string;
  requestDate: string;
  lastWorkingDate: string;
  status: OffboardingStatus;
  previousEmploymentStatus?: string;
  clearance: ClearanceItem[];
  assetsReturned?: boolean;
  finalPayrollId?: PayrollRunRef | string | null;
  exitInterview?: ExitInterview | null;
  timeline: TimelineEntry[];
  completedAt?: string | null;
  createdAt: string;
}

export interface OffboardingDetail extends Offboarding {
  assets: AssetAssignment[];
  steps: OffboardingStatus[];
  nextStatus: OffboardingStatus | null;
  canCancel: boolean;
}

export type OffboardingCreateInput = z.input<typeof offboardingCreateSchema>;
export type OffboardingAdvanceInput = z.input<typeof offboardingAdvanceSchema>;
export type AssetReturnInput = z.input<typeof assetReturnSchema>;

export const offboardingKeys = {
  all: ['offboarding'] as const,
  list: (q: object) => ['offboarding', 'list', q] as const,
  detail: (id: string) => ['offboarding', 'detail', id] as const,
  mine: ['offboarding', 'mine'] as const,
};

export const useOffboardings = (query: object) =>
  useQuery({ queryKey: offboardingKeys.list(query), queryFn: () => getPaged<Offboarding>('/offboarding', query), placeholderData: keepPreviousData });

/** The signed-in employee's active offboarding (resignation), if any. */
export const useMyActiveOffboarding = (enabled: boolean) =>
  useQuery({
    queryKey: offboardingKeys.mine,
    queryFn: async () => (await getPaged<Offboarding>('/offboarding', { scope: 'me', status: 'ACTIVE', limit: 1 })).data[0] ?? null,
    enabled,
  });

export const useOffboarding = (id: string | undefined) =>
  useQuery({ queryKey: offboardingKeys.detail(id ?? ''), queryFn: () => get<OffboardingDetail>(`/offboarding/${id}`), enabled: !!id });

export const useCreateOffboarding = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OffboardingCreateInput) => post<OffboardingDetail>('/offboarding', input),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offboardingKeys.all });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
};

export const useAdvanceOffboarding = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OffboardingAdvanceInput) => post<OffboardingDetail>(`/offboarding/${id}/advance`, input),
    // Gate errors are rendered inline in the step panel.
    meta: { silent: true },
    onSuccess: (res) => {
      qc.setQueryData(offboardingKeys.detail(id), res.data);
      void qc.invalidateQueries({ queryKey: ['offboarding', 'list'] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
};

export const useCancelOffboarding = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => post<OffboardingDetail>(`/offboarding/${id}/cancel`, { note }),
    onSuccess: (res) => {
      qc.setQueryData(offboardingKeys.detail(id), res.data);
      void qc.invalidateQueries({ queryKey: ['offboarding', 'list'] });
      void qc.invalidateQueries({ queryKey: offboardingKeys.mine });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
};

export const useReturnAsset = (offboardingId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assetId, input }: { assetId: string; input: AssetReturnInput }) => post(`/assets/${assetId}/return`, input),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: offboardingKeys.detail(offboardingId) });
      void qc.invalidateQueries({ queryKey: ['assets'] });
    },
  });
};

/* ------------------------- Payroll (final settlement) ------------------------- */

export interface PayrollRun extends PayrollRunRef {
  employeeIds?: string[];
  employeeCount?: number;
  createdAt?: string;
}

export interface PayslipRef {
  _id: string;
  payrollId: string;
  month: number;
  year: number;
  status: string;
}

export const usePayrollRuns = (enabled: boolean) =>
  useQuery({ queryKey: ['payroll', 'runs', 'offboarding-picker'], queryFn: () => getPaged<PayrollRun>('/payroll', { limit: 50 }), enabled });

export const useEmployeePayslips = (employeeId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['payroll', 'payslips', 'employee', employeeId],
    queryFn: () => getPaged<PayslipRef>('/payslips', { employeeId, scope: 'all', limit: 50 }),
    enabled: enabled && !!employeeId,
  });

export const useCreateOffCycleRun = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { month: number; year: number; employeeIds: string[]; notes?: string }) => post<PayrollRun>('/payroll', input),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
  });
};
