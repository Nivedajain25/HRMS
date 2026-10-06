import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayrollStatus, SalaryCalculationType, SalaryComponentType } from '@stencil/shared';
import { del, get, getPaged, patch, post } from '@/lib/api';

/* -------------------------------- Types -------------------------------- */

export interface UserRef {
  _id: string;
  firstName: string;
  lastName: string;
}

export interface EmployeeRef {
  _id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

export interface Slab {
  from: number;
  to: number | null;
  amount: number;
}

export interface SalaryComponent {
  _id: string;
  name: string;
  code: string;
  type: SalaryComponentType;
  calculationType: SalaryCalculationType;
  defaultValue: number;
  maxAmount: number;
  baseCap: number;
  eligibilityMaxGross: number;
  slabs: Slab[];
  taxable: boolean;
  prorate: boolean;
  isStatutory: boolean;
  employerContribution: boolean;
  order: number;
  description?: string;
  active: boolean;
}

export interface StructureLine {
  componentId: string;
  code: string;
  name: string;
  type: SalaryComponentType;
  calculationType: SalaryCalculationType;
  value: number;
  monthlyAmount: number;
  employerContribution: boolean;
}

export interface SalaryStructure {
  _id: string;
  employeeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  currency: string;
  basic: number;
  components: StructureLine[];
  monthlyGross: number;
  monthlyDeductions: number;
  monthlyEmployerContributions: number;
  monthlyNet: number;
  annualCtc: number;
  reason?: string;
  createdAt?: string;
}

export interface SalaryHistoryEntry {
  _id: string;
  effectiveFrom: string;
  previousCtc: number;
  newCtc: number;
  previousGross: number;
  newGross: number;
  changePercent: number;
  reason?: string;
  changedBy?: UserRef | null;
  createdAt: string;
}

export interface SalaryListRow extends EmployeeRef {
  departmentId?: { _id: string; name: string } | null;
  designationId?: { _id: string; name: string } | null;
  joiningDate: string;
  employmentStatus: string;
  currentStructure: Pick<
    SalaryStructure,
    '_id' | 'effectiveFrom' | 'basic' | 'monthlyGross' | 'monthlyNet' | 'monthlyDeductions' | 'monthlyEmployerContributions' | 'annualCtc' | 'currency'
  > | null;
}

export interface EmployeeSalary {
  employee: SalaryListRow;
  current: SalaryStructure | null;
  upcoming: SalaryStructure | null;
  versions: SalaryStructure[];
  history: SalaryHistoryEntry[];
}

export interface PreviewLine {
  componentId?: string;
  code: string;
  name: string;
  calculationType: SalaryCalculationType | 'EXTRA';
  value: number;
  amount: number;
}

export interface SalaryPreview {
  currency: string;
  basic: number;
  earnings: PreviewLine[];
  deductions: PreviewLine[];
  employerContributions: PreviewLine[];
  monthlyGross: number;
  monthlyDeductions: number;
  monthlyEmployerContributions: number;
  monthlyNet: number;
  annualGross: number;
  annualCtc: number;
}

export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
  category?: string;
}

export interface PayslipSummary {
  _id: string;
  employeeId: string;
  employeeSnapshot: { employeeId?: string; name?: string; department?: string; designation?: string };
  status: string;
  payableDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
}

export interface Payslip extends PayslipSummary {
  payrollId: string;
  month: number;
  year: number;
  currency: string;
  employeeSnapshot: PayslipSummary['employeeSnapshot'] & {
    workEmail?: string;
    location?: string;
    joiningDate?: string;
    bankName?: string;
    accountNumberMasked?: string;
  };
  daysInPeriod?: number;
  workingDays?: number;
  basisDays?: number;
  notEmployedDays?: number;
  presentDays?: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  absentDays?: number;
  holidays?: number;
  weekOffs?: number;
  overtimeHours?: number;
  prorationFactor?: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions?: PayslipLine[];
  paymentDate?: string | null;
  paymentReference?: string | null;
  paymentMode?: string | null;
  createdAt?: string;
  payroll?: { _id: string; month: number; year: number; status: PayrollStatus; periodStart: string; periodEnd: string; isOffCycle?: boolean } | null;
}

export interface PayrollRun {
  _id: string;
  month: number;
  year: number;
  periodStart: string;
  periodEnd: string;
  status: PayrollStatus;
  currency: string;
  employeeIds: string[];
  isOffCycle: boolean;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerContributions: number;
  notes?: string;
  warnings: string[];
  processedAt?: string | null;
  processedBy?: UserRef | null;
  approvedAt?: string | null;
  approvedBy?: UserRef | null;
  paidAt?: string | null;
  paidBy?: UserRef | null;
  paymentDate?: string | null;
  paymentReference?: string | null;
  paymentMode?: string | null;
  createdBy?: UserRef | null;
  createdAt: string;
  statusHistory: { status: PayrollStatus; at: string; by?: string }[];
}

export interface PayrollRunDetail extends PayrollRun {
  payslips: PayslipSummary[];
}

export interface PayrollSummaryMonth {
  month: number;
  runs: number;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerContributions: number;
  totalCost: number;
  statuses: string[];
}

export interface PayrollSummary {
  year: number;
  currency: string;
  months: PayrollSummaryMonth[];
  totals: { totalGross: number; totalDeductions: number; totalNet: number; totalEmployerContributions: number; totalCost: number };
  /** Runs in a currency other than `currency` (excluded from the monthly series). */
  otherCurrencies?: { currency: string; runs: number; totalGross: number; totalNet: number }[];
}

export type AdjustmentKind = 'EARNING' | 'DEDUCTION';
export type AdjustmentCategory = 'BONUS' | 'OVERTIME' | 'ADVANCE' | 'REIMBURSEMENT' | 'OTHER';

export interface Adjustment {
  _id: string;
  employeeId: EmployeeRef | null;
  month: number;
  year: number;
  kind: AdjustmentKind;
  category: AdjustmentCategory;
  amount: number;
  description?: string;
  payrollId?: string | null;
  createdAt: string;
}

export interface Loan {
  _id: string;
  employeeId: EmployeeRef | null;
  type: 'LOAN' | 'ADVANCE';
  principal: number;
  monthlyInstallment: number;
  outstanding: number;
  startMonth: number;
  startYear: number;
  status: 'ACTIVE' | 'CLOSED';
  description?: string;
  repayments: { payrollId?: string; amount: number; month: number; year: number; at: string }[];
  createdAt: string;
}

/* ------------------------------ Query keys ------------------------------ */

export const salaryKeys = {
  all: ['salary'] as const,
  list: (q: object) => ['salary', 'list', q] as const,
  employee: (id: string) => ['salary', 'employee', id] as const,
  preview: (body: object) => ['salary', 'preview', body] as const,
};

export const componentKeys = {
  all: ['salary-components'] as const,
  list: (q: object) => ['salary-components', 'list', q] as const,
  active: ['salary-components', 'all'] as const,
};

export const payrollKeys = {
  all: ['payroll'] as const,
  list: (q: object) => ['payroll', 'list', q] as const,
  detail: (id: string) => ['payroll', 'detail', id] as const,
  runPayslips: (id: string, q: object) => ['payroll', 'detail', id, 'payslips', q] as const,
  summary: (year: number) => ['payroll', 'summary', year] as const,
  adjustments: (q: object) => ['payroll', 'adjustments', q] as const,
  loans: (q: object) => ['payroll', 'loans', q] as const,
};

export const payslipKeys = {
  all: ['payslips'] as const,
  list: (q: object) => ['payslips', 'list', q] as const,
  detail: (id: string) => ['payslips', 'detail', id] as const,
};

/* -------------------------------- Salary -------------------------------- */

export const useSalaryList = (query: object) =>
  useQuery({ queryKey: salaryKeys.list(query), queryFn: () => getPaged<SalaryListRow>('/salary', query), placeholderData: keepPreviousData });

export const useEmployeeSalary = (employeeId: string | undefined) =>
  useQuery({
    queryKey: salaryKeys.employee(employeeId ?? ''),
    queryFn: () => get<EmployeeSalary>(`/salary/employee/${employeeId}`),
    enabled: !!employeeId,
  });

export const useSalaryPreview = (body: { basic: number; components: { componentId: string; value: number }[] } | null) =>
  useQuery({
    queryKey: salaryKeys.preview(body ?? {}),
    queryFn: async () => (await post<SalaryPreview>('/salary/preview', body)).data,
    enabled: !!body,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

export const useCreateStructure = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { employeeId: string; effectiveFrom: string; basic: number; components: { componentId: string; value: number }[]; reason: string }) =>
      post<SalaryStructure>('/salary', body),
    meta: { silent: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salaryKeys.all });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
};

/* ------------------------------ Components ------------------------------ */

export const useActiveComponents = (enabled = true) =>
  useQuery({ queryKey: componentKeys.active, queryFn: () => get<SalaryComponent[]>('/salary-components/all'), enabled, staleTime: 60_000 });

export const useComponentList = (query: object) =>
  useQuery({ queryKey: componentKeys.list(query), queryFn: () => getPaged<SalaryComponent>('/salary-components', query), placeholderData: keepPreviousData });

export const useSaveComponent = (id?: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => (id ? patch<SalaryComponent>(`/salary-components/${id}`, body) : post<SalaryComponent>('/salary-components', body)),
    meta: { silent: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: componentKeys.all }),
  });
};

export const useArchiveComponent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/salary-components/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: componentKeys.all }),
  });
};

/* -------------------------------- Payroll ------------------------------- */

export const usePayrollRuns = (query: object) =>
  useQuery({ queryKey: payrollKeys.list(query), queryFn: () => getPaged<PayrollRun>('/payroll', query), placeholderData: keepPreviousData });

export const usePayrollRun = (id: string | undefined) =>
  useQuery({
    queryKey: payrollKeys.detail(id ?? ''),
    queryFn: () => get<PayrollRunDetail>(`/payroll/${id}`),
    enabled: !!id,
    // Poll while another session is processing the run.
    refetchInterval: (q) => (q.state.data?.status === 'PROCESSING' ? 3000 : false),
  });

export const useRunPayslips = (id: string, query: object) =>
  useQuery({
    queryKey: payrollKeys.runPayslips(id, query),
    queryFn: () => getPaged<Payslip>(`/payroll/${id}/payslips`, query),
    placeholderData: keepPreviousData,
  });

export const usePayrollSummary = (year: number) =>
  useQuery({ queryKey: payrollKeys.summary(year), queryFn: () => get<PayrollSummary>('/payroll/summary', { year }) });

const useInvalidatePayroll = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: payrollKeys.all });
    void qc.invalidateQueries({ queryKey: payslipKeys.all });
  };
};

export const useCreatePayroll = () => {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (body: { month: number; year: number; employeeIds?: string[]; notes?: string }) => post<PayrollRun>('/payroll', body),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export type RunAction = 'process' | 'approve' | 'cancel' | 'reopen';

export const useRunAction = (id: string) => {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (action: RunAction) => post<PayrollRunDetail>(`/payroll/${id}/${action}`),
    meta: { silent: true },
    onSettled: invalidate,
  });
};

export const usePayRun = (id: string) => {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (body: { paymentDate: string; paymentMode: string; paymentReference?: string }) => post<PayrollRunDetail>(`/payroll/${id}/pay`, body),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

/* -------------------------- Adjustments & loans -------------------------- */

export const useAdjustments = (query: object) =>
  useQuery({ queryKey: payrollKeys.adjustments(query), queryFn: () => getPaged<Adjustment>('/payroll/adjustments', query), placeholderData: keepPreviousData });

export const useSaveAdjustment = (id?: string) => {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => (id ? patch<Adjustment>(`/payroll/adjustments/${id}`, body) : post<Adjustment>('/payroll/adjustments', body)),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useDeleteAdjustment = () => {
  const invalidate = useInvalidatePayroll();
  return useMutation({ mutationFn: (id: string) => del(`/payroll/adjustments/${id}`), onSuccess: invalidate });
};

export const useLoans = (query: object) =>
  useQuery({ queryKey: payrollKeys.loans(query), queryFn: () => getPaged<Loan>('/payroll/loans', query), placeholderData: keepPreviousData });

export const useCreateLoan = () => {
  const invalidate = useInvalidatePayroll();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Loan>('/payroll/loans', body),
    meta: { silent: true },
    onSuccess: invalidate,
  });
};

export const useCloseLoan = () => {
  const invalidate = useInvalidatePayroll();
  return useMutation({ mutationFn: (id: string) => post<Loan>(`/payroll/loans/${id}/close`), onSuccess: invalidate });
};

/* -------------------------------- Payslips ------------------------------- */

export const usePayslips = (query: object, enabled = true) =>
  useQuery({ queryKey: payslipKeys.list(query), queryFn: () => getPaged<Payslip>('/payslips', query), placeholderData: keepPreviousData, enabled });

export const usePayslip = (id: string | null | undefined) =>
  useQuery({ queryKey: payslipKeys.detail(id ?? ''), queryFn: () => get<Payslip>(`/payslips/${id}`), enabled: !!id });
