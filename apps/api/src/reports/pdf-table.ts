import PDFDocument from 'pdfkit';
import type { CellValue, ReportColumn, ReportRow } from './types';

export interface PdfTableOptions {
  title: string;
  organization: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: Record<string, unknown>;
  generatedAt?: Date;
  timezone?: string;
}

const MARGIN = 32;
const FONT_SIZE = 7.5;
const ROW_H = 14;
const HEADER_H = 18;
const FOOTER_H = 20;

/** Standard PDF fonts only cover WinAnsi; replace anything else so output never garbles. */
const pdfSafe = (s: string) => s.replace(/→/g, '->').replace(/[^\x20-\x7E\u00A0-ÿ…–—‘’“”•]/g, '?');

const fmt = (v: CellValue | undefined, type?: ReportColumn['type']) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return type === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
  return pdfSafe(String(v));
};

const scalarSummary = (summary: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(summary).flatMap(([k, v]) => {
    const key = prefix ? `${prefix} / ${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return scalarSummary(v as Record<string, unknown>, key);
    return [`${key}: ${v === null || v === undefined ? '-' : String(v)}`];
  });

/**
 * Renders a landscape A4 PDF with an organization header, a zebra-striped
 * table whose header repeats on every page, a summary block and
 * "Page X of Y" footers.
 */
export const renderPdfTable = (opts: PdfTableOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const generatedAt = opts.generatedAt ?? new Date();
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: MARGIN,
      bufferPages: true,
      info: { Title: pdfSafe(opts.title), Author: pdfSafe(opts.organization), Creator: 'Stencil HRMS' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const left = MARGIN;
      const width = doc.page.width - MARGIN * 2;
      const bottomLimit = () => doc.page.height - MARGIN - FOOTER_H;
      const generatedLabel = generatedAt.toLocaleString('en-GB', { timeZone: opts.timezone ?? 'UTC', dateStyle: 'medium', timeStyle: 'short' });

      // Proportional column widths from content length (sampled).
      const cols = opts.columns.length ? opts.columns : [{ key: '_', label: '' }];
      const weights = cols.map((c) => {
        const sample = opts.rows.slice(0, 300).map((r) => fmt(r[c.key], c.type).length);
        return Math.min(28, Math.max(4, c.label.length * 0.8, ...sample));
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / totalWeight) * width);

      // Title block (first page only).
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827').text(pdfSafe(opts.organization), left, MARGIN, { width });
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#4f46e5').text(pdfSafe(opts.title), { width });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#6b7280')
        .text(pdfSafe([opts.subtitle, `Generated ${generatedLabel}`, `${opts.rows.length} row(s)`].filter(Boolean).join('   |   ')), { width });
      let y = doc.y + 10;

      const drawHeader = () => {
        doc.rect(left, y, width, HEADER_H).fill('#4f46e5');
        doc.font('Helvetica-Bold').fontSize(FONT_SIZE).fillColor('#ffffff');
        let x = left;
        cols.forEach((c, i) => {
          doc.text(pdfSafe(c.label), x + 3, y + 5, { width: widths[i]! - 6, height: HEADER_H - 6, ellipsis: true, lineBreak: false, align: c.type === 'number' ? 'right' : 'left' });
          x += widths[i]!;
        });
        y += HEADER_H;
      };

      drawHeader();
      opts.rows.forEach((row, index) => {
        if (y + ROW_H > bottomLimit()) {
          doc.addPage();
          y = MARGIN;
          drawHeader();
        }
        if (index % 2 === 1) doc.rect(left, y, width, ROW_H).fill('#f3f4f6');
        doc.font('Helvetica').fontSize(FONT_SIZE).fillColor('#111827');
        let x = left;
        cols.forEach((c, i) => {
          doc.text(fmt(row[c.key], c.type), x + 3, y + 4, {
            width: widths[i]! - 6,
            height: ROW_H - 4,
            ellipsis: true,
            lineBreak: false,
            align: c.type === 'number' ? 'right' : 'left',
          });
          x += widths[i]!;
        });
        y += ROW_H;
      });
      if (!opts.rows.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280').text('No records for the selected filters.', left, y + 8, { width });
        y += 24;
      }

      const lines = opts.summary ? scalarSummary(opts.summary).slice(0, 60) : [];
      if (lines.length) {
        y += 12;
        if (y + 30 > bottomLimit()) {
          doc.addPage();
          y = MARGIN;
        }
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Summary', left, y, { width });
        y = doc.y + 4;
        doc.font('Helvetica').fontSize(8).fillColor('#374151');
        for (const line of lines) {
          if (y + 12 > bottomLimit()) {
            doc.addPage();
            y = MARGIN;
          }
          doc.text(pdfSafe(line), left, y, { width, lineBreak: false, ellipsis: true, height: 11 });
          y += 11;
        }
      }

      // Footers with page numbers (pages are buffered).
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0; // writing inside the margin must not trigger a new page
        const fy = doc.page.height - MARGIN - 10;
        doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af');
        doc.text(pdfSafe(`${opts.organization} - ${opts.title} - generated ${generatedLabel}`), left, fy, { width: width / 2, lineBreak: false });
        doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width / 2, fy, { width: width / 2, align: 'right', lineBreak: false });
        doc.page.margins.bottom = bottom;
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
