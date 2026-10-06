import { amountInWords } from '../payroll/core/words';
import {
  addPageFooters,
  brandHeader,
  callout,
  contentLeft,
  contentWidth,
  createPdf,
  formatAmount,
  formatDate,
  formatMoney,
  keyValueGrid,
  paragraph,
  renderPdf,
  sectionTitle,
  table,
} from './document';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (month: number, year: number) => `${MONTHS[month - 1]} ${year}`;

export interface PayslipPdfData {
  organization: { name: string; legalName?: string | null; address?: string | null; city?: string | null; state?: string | null; country?: string | null; postalCode?: string | null; email?: string | null; phone?: string | null };
  payslip: {
    month: number;
    year: number;
    currency: string;
    status: string;
    employeeSnapshot?: {
      employeeId?: string | null;
      name?: string | null;
      department?: string | null;
      designation?: string | null;
      location?: string | null;
      joiningDate?: Date | null;
      bankName?: string | null;
      accountNumberMasked?: string | null;
    } | null;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    daysInPeriod?: number | null;
    workingDays?: number | null;
    payableDays?: number | null;
    presentDays?: number | null;
    paidLeaveDays?: number | null;
    unpaidLeaveDays?: number | null;
    absentDays?: number | null;
    lopDays?: number | null;
    holidays?: number | null;
    weekOffs?: number | null;
    overtimeHours?: number | null;
    earnings: { name?: string | null; code?: string | null; amount?: number | null }[];
    deductions: { name?: string | null; code?: string | null; amount?: number | null }[];
    employerContributions?: { name?: string | null; code?: string | null; amount?: number | null }[];
    grossEarnings: number;
    totalDeductions: number;
    netPay: number;
    paymentDate?: Date | null;
    paymentReference?: string | null;
    paymentMode?: string | null;
  };
}

const num = (v: number | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/** Renders a payslip PDF. Only the masked bank account number is ever printed. */
export const renderPayslipPdf = async ({ organization: org, payslip: p }: PayslipPdfData): Promise<Buffer> => {
  const period = periodLabel(p.month, p.year);
  const emp = p.employeeSnapshot ?? {};
  const doc = createPdf({ title: `Payslip ${period} - ${emp.name ?? ''}`, subject: `Payslip for ${period}`, author: org.name });

  const addressLines = [
    org.legalName && org.legalName !== org.name ? org.legalName : null,
    org.address,
    [org.city, org.state, org.postalCode].filter(Boolean).join(', '),
    org.country,
    [org.email, org.phone].filter(Boolean).join('  |  '),
  ].filter((l): l is string => !!l);
  brandHeader(doc, { organization: { name: org.name, addressLines }, title: 'PAYSLIP', subtitle: `Pay period: ${period}${p.status === 'DRAFT' ? ' (DRAFT)' : ''}` });

  sectionTitle(doc, 'Employee');
  keyValueGrid(doc, [
    ['Employee name', emp.name ?? '-'],
    ['Employee ID', emp.employeeId ?? '-'],
    ['Department', emp.department ?? '-'],
    ['Designation', emp.designation ?? '-'],
    ['Location', emp.location ?? '-'],
    ['Date of joining', formatDate(emp.joiningDate)],
    ['Bank', emp.bankName ?? '-'],
    ['Account number', emp.accountNumberMasked ?? '-'],
  ]);

  sectionTitle(doc, 'Attendance');
  keyValueGrid(
    doc,
    [
      ['Days in period', num(p.daysInPeriod)],
      ['Working days', num(p.workingDays)],
      ['Payable days', num(p.payableDays)],
      ['Present days', num(p.presentDays)],
      ['Paid leave', num(p.paidLeaveDays)],
      ['Loss of pay days', num(p.lopDays ?? (p.unpaidLeaveDays ?? 0) + (p.absentDays ?? 0))],
      ['Holidays', num(p.holidays)],
      ['Week offs', num(p.weekOffs)],
      ...(p.overtimeHours ? ([['Overtime hours', num(p.overtimeHours)]] as [string, string][]) : []),
    ],
    { columns: 4, labelWidth: 70 },
  );

  // Earnings and deductions side by side.
  const left = contentLeft(doc);
  const gap = 12;
  const half = (contentWidth(doc) - gap) / 2;
  const startY = doc.y;
  const earningsEnd = table(doc, {
    x: left,
    y: startY,
    width: half,
    columns: [{ header: 'Earnings', width: 2 }, { header: `Amount (${p.currency})`, width: 1.2, align: 'right' }],
    rows: p.earnings.map((l) => [l.name ?? l.code ?? '', formatAmount(l.amount)]),
    footer: ['Gross earnings', formatAmount(p.grossEarnings)],
    emptyText: 'No earnings',
  });
  const earningsPage = doc.bufferedPageRange().count;
  const deductionsEnd = table(doc, {
    x: left + half + gap,
    y: startY,
    width: half,
    columns: [{ header: 'Deductions', width: 2 }, { header: `Amount (${p.currency})`, width: 1.2, align: 'right' }],
    rows: p.deductions.map((l) => [l.name ?? l.code ?? '', formatAmount(l.amount)]),
    footer: ['Total deductions', formatAmount(p.totalDeductions)],
    emptyText: 'No deductions',
  });
  doc.y = (doc.bufferedPageRange().count === earningsPage ? Math.max(earningsEnd, deductionsEnd) : deductionsEnd) + 14;
  doc.x = left;

  callout(doc, 'Net pay', formatMoney(p.netPay, p.currency), amountInWords(p.netPay, p.currency));

  if (p.employerContributions?.length) {
    sectionTitle(doc, 'Employer contributions (part of CTC, not deducted)');
    table(doc, {
      columns: [{ header: 'Contribution', width: 3 }, { header: `Amount (${p.currency})`, width: 1, align: 'right' }],
      rows: p.employerContributions.map((l) => [l.name ?? l.code ?? '', formatAmount(l.amount)]),
    });
  }

  sectionTitle(doc, 'Payment');
  keyValueGrid(doc, [
    ['Status', p.status],
    ['Payment date', formatDate(p.paymentDate)],
    ['Payment mode', (p.paymentMode ?? '-').replace(/_/g, ' ')],
    ['Reference', p.paymentReference ?? '-'],
  ]);

  paragraph(doc, 'This is a system generated payslip and does not require a signature.', { muted: true, size: 8.5 });
  addPageFooters(doc, `${org.name} - Payslip for ${period} - Generated by Stencil HRMS on ${formatDate(new Date())}`);
  return renderPdf(doc);
};
