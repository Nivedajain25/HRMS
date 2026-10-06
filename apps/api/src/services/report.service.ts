import type { ReportQueryOutput, ReportType } from '@stencil/shared';
import { OrganizationModel } from '../models';
import { toCsv } from '../reports/csv';
import { REPORTS } from '../reports/definitions';
import { renderPdfTable } from '../reports/pdf-table';
import { toXlsx } from '../reports/xlsx';
import type { RequestContext } from '../types/context';
import { todayKey } from '../utils/dates';
import { forbidden, notFound } from '../utils/errors';

const canRun = (ctx: RequestContext, type: ReportType) => REPORTS[type].permissions.every((p) => ctx.permissions.has(p));

/** Report types the user may run (with their descriptions and required permissions). */
export const listReports = (ctx: RequestContext) =>
  Object.values(REPORTS)
    .filter((r) => canRun(ctx, r.type))
    .map((r) => ({ type: r.type, title: r.title, description: r.description, permissions: r.permissions, formats: ['json', 'csv', 'xlsx', 'pdf'] }));

export type ReportOutput =
  | { kind: 'json'; data: Record<string, unknown> }
  | { kind: 'file'; buffer: Buffer; contentType: string; filename: string };

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export const runReport = async (ctx: RequestContext, type: ReportType, q: ReportQueryOutput): Promise<ReportOutput> => {
  const def = REPORTS[type];
  if (!def) throw notFound('Report');
  if (!canRun(ctx, type)) throw forbidden('You do not have permission to run this report');

  const result = await def.build(ctx, { from: q.from, to: q.to, departmentId: q.departmentId ?? null, status: q.status });

  if (q.format === 'json') {
    const total = result.rows.length;
    const start = (q.page - 1) * q.limit;
    return {
      kind: 'json',
      data: {
        type,
        title: def.title,
        columns: result.columns,
        rows: result.rows.slice(start, start + q.limit),
        summary: result.summary,
        range: result.range ?? null,
        pagination: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) },
      },
    };
  }

  const org = await OrganizationModel.findById(ctx.organizationId).select('name').lean();
  const organization = org?.name ?? 'Organization';
  const date = todayKey(ctx.timezone);
  const filename = `stencil-${type}-report-${date}.${q.format}`;
  const subtitle = result.range ? `Period ${result.range.from} to ${result.range.to}` : undefined;

  let buffer: Buffer;
  if (q.format === 'csv') buffer = toCsv(result.columns, result.rows);
  else if (q.format === 'xlsx') buffer = await toXlsx({ title: def.title, organization, columns: result.columns, rows: result.rows, summary: result.summary });
  else buffer = await renderPdfTable({ title: def.title, organization, subtitle, columns: result.columns, rows: result.rows, summary: result.summary, timezone: ctx.timezone });

  return { kind: 'file', buffer, contentType: CONTENT_TYPES[q.format], filename };
};
