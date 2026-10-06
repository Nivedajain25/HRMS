import type { CellValue, ReportColumn, ReportRow } from './types';

/** Characters that make spreadsheet apps evaluate a cell as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Escapes one CSV field:
 *  - strings starting with = + - @ (or tab / CR) are prefixed with `'` so
 *    spreadsheets treat them as text (CSV/formula injection defence);
 *  - fields containing a quote, comma or line break are quoted, with inner
 *    quotes doubled (RFC 4180).
 * Numbers are emitted as-is (a negative number is data, not a formula).
 */
export const csvCell = (value: CellValue | undefined): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

/** RFC 4180 CSV with CRLF line endings and a UTF-8 BOM (for Excel). */
export const toCsv = (columns: ReportColumn[], rows: ReportRow[]): Buffer => {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(','));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
};
