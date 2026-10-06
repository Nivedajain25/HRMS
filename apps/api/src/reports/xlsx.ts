import ExcelJS from 'exceljs';
import type { ReportColumn, ReportRow } from './types';

const flattenSummary = (summary: Record<string, unknown>, prefix = ''): [string, string | number][] =>
  Object.entries(summary).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return flattenSummary(v as Record<string, unknown>, key);
    return [[key, typeof v === 'number' ? v : v === null || v === undefined ? '' : String(v)] as [string, string | number]];
  });

/** Builds an .xlsx workbook: a data sheet (typed cells, frozen header, autofilter) and a summary sheet. */
export const toXlsx = async (opts: {
  title: string;
  organization: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: Record<string, unknown>;
}): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stencil HRMS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = opts.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(40, Math.max(10, c.label.length + 2, ...opts.rows.slice(0, 200).map((r) => String(r[c.key] ?? '').length + 2))),
    style: c.type === 'number' ? { numFmt: '#,##0.##' } : {},
  }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  // Values are always written as plain values (never as formula objects), so
  // text beginning with "=" stays text.
  for (const row of opts.rows) ws.addRow(Object.fromEntries(opts.columns.map((c) => [c.key, row[c.key] ?? null])));
  if (opts.columns.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: opts.columns.length } };
  }

  const sum = wb.addWorksheet('Summary');
  sum.columns = [
    { header: 'Metric', key: 'k', width: 40 },
    { header: 'Value', key: 'v', width: 24 },
  ];
  sum.getRow(1).font = { bold: true };
  sum.addRow({ k: 'Report', v: opts.title });
  sum.addRow({ k: 'Organization', v: opts.organization });
  sum.addRow({ k: 'Generated at', v: new Date().toISOString() });
  for (const [k, v] of flattenSummary(opts.summary)) sum.addRow({ k, v });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
};
