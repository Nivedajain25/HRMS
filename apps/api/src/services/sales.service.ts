import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { SalesMonthModel } from '../models';
import type { RequestContext } from '../types/context';
import { badRequest } from '../utils/errors';
import { audit } from './audit.service';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A month from a sheet cell: a real date, "2026-09", "09/2026", "9-2026", "Sep 2026", "September-26", "Sep'26"…
 * Returns `YYYY-MM` or null.
 */
export const parseMonth = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date.
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${pad(Number(m[2]))}` : null;
  m = /^(?:\d{1,2}[-/.])?(\d{1,2})[-/.](\d{4}|\d{2})$/.exec(s);
  if (m) {
    const mo = Number(m[1]);
    const yr = m[2]!.length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${yr}-${pad(mo)}` : null;
  }
  // "Sep 2026", "September-26", "Sep'26" (name first) or "2026 Sep" (year first).
  const named = /^([a-z]{3,9})[\s\-'’,./]*(\d{4}|\d{2})$/.exec(s);
  const yearFirst = named ? null : /^(\d{4})[\s\-'’,./]*([a-z]{3,9})$/.exec(s);
  const name = named?.[1] ?? yearFirst?.[2];
  const year = named?.[2] ?? yearFirst?.[1];
  if (!name || !year) return null;
  const idx = MONTHS.indexOf(name.slice(0, 3));
  const yr = year.length === 2 ? 2000 + Number(year) : Number(year);
  return idx >= 0 ? `${yr}-${pad(idx + 1)}` : null;
};

/** A money cell: 1250000, "₹12,50,000", "12.5 L", "1.2 Cr", "(1,000)" → number (null if not a number). */
export const parseAmount = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'result' in v) return parseAmount((v as { result: unknown }).result);
  let s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  let mult = 1;
  if (/(cr|crore)s?\.?$/.test(s)) mult = 1e7;
  else if (/(l|lac|lakh|lakhs)\.?$/.test(s)) mult = 1e5;
  else if (/k$/.test(s)) mult = 1e3;
  s = s.replace(/[^\d.]/g, '');
  if (!s) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) ? (negative ? -n : n) : null;
};

const cellValue = (c: ExcelJS.Cell) => {
  const v = c.value as unknown;
  if (v && typeof v === 'object' && 'result' in (v as object)) return (v as { result: unknown }).result;
  if (v && typeof v === 'object' && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  if (v && typeof v === 'object' && 'text' in (v as object)) return (v as { text: unknown }).text;
  return v;
};

/**
 * Imports monthly sales from an Excel (.xlsx) or CSV sheet: finds the header row with a "Month" column and a
 * "Sales" / "Amount" / "Revenue" / "Total" column (optionally "Target"), then upserts one figure per month.
 * Re-importing a month replaces it.
 */
export const importSales = async (ctx: RequestContext, file: Express.Multer.File | undefined) => {
  if (!file?.buffer?.length) throw badRequest('Choose an Excel (.xlsx) or CSV file', 'FILE_REQUIRED');
  const name = (file.originalname || '').toLowerCase();
  const wb = new ExcelJS.Workbook();
  try {
    if (name.endsWith('.csv') || file.mimetype === 'text/csv') await wb.csv.read(Readable.from(file.buffer));
    else if (name.endsWith('.xlsx') || file.mimetype.includes('spreadsheetml')) await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    else throw new Error('type');
  } catch {
    throw badRequest('Could not read the file. Upload an .xlsx or .csv file (old .xls files: save as .xlsx first).', 'UNREADABLE_FILE');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('The file has no sheets', 'EMPTY_FILE');

  // Header row: the first row (within the top 10) that has a month column and an amount column.
  let headerRow = 0;
  let monthCol = 0;
  let amountCol = 0;
  let targetCol = 0;
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const row = ws.getRow(r);
    let mc = 0;
    let ac = 0;
    let tc = 0;
    row.eachCell((cell, col) => {
      const h = String(cellValue(cell) ?? '').trim().toLowerCase();
      if (!mc && /month|period|date/.test(h)) mc = col;
      else if (!tc && /target|goal|budget/.test(h)) tc = col;
      else if (!ac && /sales|amount|revenue|total|value|turnover|net/.test(h)) ac = col;
    });
    if (mc && ac) [headerRow, monthCol, amountCol, targetCol] = [r, mc, ac, tc];
  }
  if (!headerRow) throw badRequest('Add a header row with a "Month" column and a "Sales" (or Amount / Revenue) column.', 'NO_HEADER');

  const byMonth = new Map<string, { amount: number; target: number | null }>();
  const skipped: number[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const mRaw = cellValue(row.getCell(monthCol));
    const aRaw = cellValue(row.getCell(amountCol));
    if ((mRaw === null || mRaw === undefined || mRaw === '') && (aRaw === null || aRaw === undefined || aRaw === '')) continue;
    const month = parseMonth(mRaw);
    const amount = parseAmount(aRaw);
    if (!month || amount === null) {
      skipped.push(r);
      continue;
    }
    const target = targetCol ? parseAmount(cellValue(row.getCell(targetCol))) : null;
    const prev = byMonth.get(month);
    // Several rows for the same month (e.g. per branch) are added up.
    byMonth.set(month, { amount: (prev?.amount ?? 0) + amount, target: target ?? prev?.target ?? null });
  }
  if (!byMonth.size) throw badRequest('No rows with a valid month and amount were found.', 'NO_ROWS');

  await SalesMonthModel.bulkWrite(
    [...byMonth].map(([month, v]) => ({
      updateOne: {
        filter: { organizationId: ctx.organizationId, month },
        update: { $set: { amount: v.amount, target: v.target, updatedBy: ctx.userId } },
        upsert: true,
      },
    })),
  );
  const months = [...byMonth.keys()].sort();
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'sales', recordLabel: `Sales imported: ${months.length} month(s), ${months[0]} to ${months.at(-1)}` });
  return { imported: months.length, from: months[0], to: months.at(-1), skippedRows: skipped.slice(0, 20) };
};

/** The last `months` months of sales, oldest first (months with no figure are included as null). */
export const monthlySales = async (ctx: RequestContext, q: { months?: number }) => {
  const n = Math.min(36, Math.max(3, q.months ?? 12));
  const latest = await SalesMonthModel.findOne({ organizationId: ctx.organizationId }).sort({ month: -1 }).select('month').lean();
  const now = new Date();
  // End at the current month, or the latest imported month if that's later.
  let [y, m] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
  if (latest) {
    const [ly, lm] = latest.month.split('-').map(Number) as [number, number];
    if (ly * 12 + lm > y * 12 + m) [y, m] = [ly, lm];
  }
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = y * 12 + (m - 1) - i;
    keys.push(`${Math.floor(t / 12)}-${pad((t % 12) + 1)}`);
  }
  const rows = await SalesMonthModel.find({ organizationId: ctx.organizationId, month: { $in: keys } }).select('month amount target updatedAt').lean();
  const byKey = new Map(rows.map((r) => [r.month, r]));
  const lastUpdated = rows.reduce<Date | null>((a, r) => (!a || r.updatedAt > a ? r.updatedAt : a), null);
  return {
    months: keys.map((k) => ({ month: k, amount: byKey.get(k)?.amount ?? null, target: byKey.get(k)?.target ?? null })),
    hasData: rows.length > 0,
    lastUpdated,
  };
};
