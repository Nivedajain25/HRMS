import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ASSET_STATUS,
  ATTENDANCE_STATUS,
  EMPLOYMENT_STATUS,
  EXPENSE_STATUS,
  JOB_STATUS,
  LEAVE_STATUS,
  REPORT_TYPES,
  REVIEW_STATUS,
  type ReportType,
} from '@stencil/shared';
import type { Pagination } from '@stencil/types';
import { ApiError, downloadFile, get, toApiError } from '@/lib/api';

export interface ReportInfo {
  type: ReportType;
  title: string;
  description: string;
  permissions: string[];
  formats: string[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'number' | 'date' | 'string';
}

export type ReportCell = string | number | boolean | null;

export interface ReportResult {
  type: ReportType;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  summary: Record<string, unknown>;
  range: { from: string; to: string } | null;
  pagination: Pagination;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  departmentId?: string;
  status?: string;
}

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export const reportKeys = {
  all: ['reports'] as const,
  list: ['reports', 'list'] as const,
  run: (type: string, q: object) => ['reports', 'run', type, q] as const,
};

export const isReportType = (v: string | undefined): v is ReportType => !!v && (REPORT_TYPES as readonly string[]).includes(v);

export const useReportList = () => useQuery({ queryKey: reportKeys.list, queryFn: () => get<ReportInfo[]>('/reports'), staleTime: 5 * 60_000 });

export const useReport = (type: ReportType, query: ReportFilters & { page: number; limit: number }, enabled: boolean) =>
  useQuery({
    queryKey: reportKeys.run(type, query),
    queryFn: () => get<ReportResult>(`/reports/${type}`, { ...query, format: 'json' }),
    placeholderData: keepPreviousData,
    enabled,
  });

/**
 * Downloads an export. Blob error bodies can't be decoded by the shared API
 * layer, so failures are rethrown with a readable message.
 */
export const exportReport = async (type: ReportType, filters: ReportFilters, format: ExportFormat) => {
  try {
    await downloadFile(`/reports/${type}`, { ...filters, format }, `stencil-${type}-report.${format}`);
  } catch (err) {
    const e = toApiError(err);
    if (e.status === 0 || !/^Request failed/i.test(e.message)) throw e;
    const reason = e.status === 403 ? 'you do not have permission to export this report' : e.status === 400 ? 'the filters are invalid' : `the server responded with ${e.status}`;
    throw new ApiError(`Export failed: ${reason}.`, e.status, e.code);
  }
};

/* ------------------------------ Filter meta ----------------------------- */

interface ReportMeta {
  /** Label for the date range filter, or null when the report ignores dates. */
  dateLabel: string | null;
  statusLabel: string;
  statuses: readonly string[];
}

export const REPORT_META: Record<ReportType, ReportMeta> = {
  employees: { dateLabel: 'Joined between', statusLabel: 'Employment status', statuses: EMPLOYMENT_STATUS },
  attendance: { dateLabel: 'Period', statusLabel: 'Employment status', statuses: EMPLOYMENT_STATUS },
  attendance_log: { dateLabel: 'Period', statusLabel: 'Attendance status', statuses: ATTENDANCE_STATUS },
  leave: { dateLabel: 'Period', statusLabel: 'Request status', statuses: LEAVE_STATUS },
  payroll: { dateLabel: 'Pay periods', statusLabel: 'Payslip status', statuses: ['DRAFT', 'FINAL', 'PAID', 'CANCELLED'] },
  expenses: { dateLabel: 'Expense date', statusLabel: 'Claim status', statuses: EXPENSE_STATUS },
  recruitment: { dateLabel: 'Applied between', statusLabel: 'Job status', statuses: JOB_STATUS },
  performance: { dateLabel: 'Cycles overlapping', statusLabel: 'Review status', statuses: REVIEW_STATUS },
  assets: { dateLabel: null, statusLabel: 'Asset status', statuses: ASSET_STATUS },
};
