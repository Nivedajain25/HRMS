import type { Permission, ReportType } from '@stencil/shared';
import type { RequestContext } from '../types/context';

export type CellValue = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  /** Hint for exporters (alignment / number formats). */
  type?: 'string' | 'number' | 'date';
}

export type ReportRow = Record<string, CellValue>;

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: Record<string, unknown>;
  /** Effective date range used (after defaults). */
  range?: { from: string; to: string };
}

export interface ReportParams {
  from?: string;
  to?: string;
  departmentId?: string | null;
  status?: string;
}

export interface ReportDefinition {
  type: ReportType;
  title: string;
  description: string;
  /** All required (report:read is always included). */
  permissions: Permission[];
  build: (ctx: RequestContext, params: ReportParams) => Promise<ReportResult>;
}
