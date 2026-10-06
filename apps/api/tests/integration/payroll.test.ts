import { beforeAll, describe, expect, it } from 'vitest';
import {
  AttendanceModel,
  AuditLogModel,
  EmployeeHistoryModel,
  LeaveRequestModel,
  LeaveTypeModel,
  LoanModel,
  NotificationModel,
  PayslipModel,
} from '../../src/models';
import { sentEmails } from '../../src/services/email.service';
import { dateOnly } from '../../src/utils/dates';
import { as, createEmployeeUser, registerOrg } from '../helpers';

type Comp = { _id: string; code: string };

/** Supertest parser collecting a binary body. */
const binary = (res: { on: (event: string, listener: (chunk: Buffer) => void) => unknown }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Payroll: components, salary structures, runs, payslips', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let orgId: string;
  let comps: Record<string, string>;
  let payAdmin: Awaited<ReturnType<typeof createEmployeeUser>>;
  let plain: Awaited<ReturnType<typeof createEmployeeUser>>;

  const structureBody = (employeeId: string, effectiveFrom: string, basic: number, reason = 'Annual review') => ({
    employeeId,
    effectiveFrom,
    basic,
    reason,
    components: [
      { componentId: comps.HRA, value: 40 },
      { componentId: comps.PF, value: 12 },
      { componentId: comps.PF_ER, value: 12 },
      { componentId: comps.ESI, value: 0.75 },
      { componentId: comps.PT, value: 0 },
    ],
  });

  beforeAll(async () => {
    admin = await registerOrg({ country: 'IN' });
    orgId = admin.user.organization._id;
    const all = await as(admin.token).get('/api/v1/salary-components/all');
    expect(all.status).toBe(200);
    comps = Object.fromEntries((all.body.data as Comp[]).map((c) => [c.code, c._id]));
    expect(comps.BASIC).toBeTruthy();
    payAdmin = await createEmployeeUser(admin.token, { firstName: 'Payroll', roles: ['payroll_admin'] });
    plain = await createEmployeeUser(admin.token, { firstName: 'Plain' });
  });

  it('manages salary components with permissions and BASIC protection', async () => {
    expect((await as(plain.token).get('/api/v1/salary-components')).status).toBe(403);
    expect((await as(plain.token).post('/api/v1/salary-components', { name: 'X', code: 'X', type: 'EARNING' })).status).toBe(403);

    const created = await as(payAdmin.token).post('/api/v1/salary-components', {
      name: 'Shift Allowance',
      code: 'SHIFT',
      type: 'EARNING',
      calculationType: 'FIXED',
      defaultValue: 500,
    });
    expect(created.status).toBe(201);
    const id = created.body.data._id;

    // PATCH keeps omitted fields untouched.
    const renamed = await as(payAdmin.token).patch(`/api/v1/salary-components/${id}`, { name: 'Night Shift Allowance' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.defaultValue).toBe(500);
    expect(renamed.body.data.calculationType).toBe('FIXED');
    // Cross-field rules are validated on the merged document.
    expect((await as(payAdmin.token).patch(`/api/v1/salary-components/${id}`, { calculationType: 'SLAB' })).status).toBe(400);
    expect((await as(payAdmin.token).patch(`/api/v1/salary-components/${id}`, { calculationType: 'PERCENT_OF_BASIC', defaultValue: 150 })).status).toBe(400);

    expect((await as(payAdmin.token).post('/api/v1/salary-components', { name: 'Basic 2', code: 'BASIC', type: 'EARNING' })).status).toBe(409);
    expect((await as(payAdmin.token).patch(`/api/v1/salary-components/${comps.BASIC}`, { type: 'DEDUCTION' })).status).toBe(422);
    expect((await as(payAdmin.token).delete(`/api/v1/salary-components/${comps.BASIC}`)).status).toBe(422);

    expect((await as(payAdmin.token).delete(`/api/v1/salary-components/${id}`)).status).toBe(200);
    const list = await as(payAdmin.token).get('/api/v1/salary-components?limit=100');
    expect(list.body.data.some((c: Comp) => c._id === id)).toBe(false);
  });

  it('previews and versions salary structures with history, audit and strict access', async () => {
    const mgr = await createEmployeeUser(admin.token, { firstName: 'Boss', roles: ['manager'] });
    const emp = await createEmployeeUser(admin.token, { firstName: 'Sal', managerId: mgr.employee._id });
    const empId = emp.employee._id;

    const preview = await as(payAdmin.token).post('/api/v1/salary/preview', { basic: 20000, components: structureBody(empId, '2026-01-01', 0).components });
    expect(preview.status).toBe(200);
    const p = preview.body.data;
    expect(p.monthlyGross).toBe(28000);
    expect(p.deductions.find((d: { code: string }) => d.code === 'PF').amount).toBe(1800);
    expect(p.deductions.find((d: { code: string }) => d.code === 'ESI').amount).toBe(0); // gross above ESI ceiling
    expect(p.deductions.find((d: { code: string }) => d.code === 'PT').amount).toBe(200);
    expect(p.monthlyDeductions).toBe(2000);
    expect(p.monthlyEmployerContributions).toBe(1800);
    expect(p.monthlyNet).toBe(26000);
    expect(p.annualCtc).toBe(12 * (28000 + 1800));

    const v1 = await as(payAdmin.token).post('/api/v1/salary', structureBody(empId, '2026-01-01', 20000, 'Joining'));
    expect(v1.status).toBe(201);
    expect(v1.body.data.annualCtc).toBe(357600);

    // Same/earlier effective date is rejected.
    expect((await as(payAdmin.token).post('/api/v1/salary', structureBody(empId, '2026-01-01', 21000))).status).toBe(422);

    const v2 = await as(payAdmin.token).post('/api/v1/salary', structureBody(empId, '2026-04-01', 25000, 'Promotion'));
    expect(v2.status).toBe(201);
    expect(v2.body.data.annualCtc).toBe(12 * (35000 + 1800));

    const view = await as(payAdmin.token).get(`/api/v1/salary/employee/${empId}`);
    expect(view.status).toBe(200);
    expect(view.body.data.versions).toHaveLength(2);
    const older = view.body.data.versions.find((v: { _id: string }) => v._id === v1.body.data._id);
    expect(older.effectiveTo.slice(0, 10)).toBe('2026-03-31');
    expect(view.body.data.current._id).toBe(v2.body.data._id);
    expect(view.body.data.history).toHaveLength(2);
    const raise = view.body.data.history.find((h: { structureId: string }) => h.structureId === v2.body.data._id);
    expect(raise.previousCtc).toBe(357600);
    expect(raise.newCtc).toBe(441600);
    expect(raise.changePercent).toBeCloseTo(23.49, 2);

    expect(await EmployeeHistoryModel.countDocuments({ employeeId: empId, field: 'salary' })).toBe(2);
    const auditRow = await AuditLogModel.findOne({ action: 'SALARY_UPDATED', recordId: v2.body.data._id }).lean();
    expect((auditRow?.newValues as { annualCtc: number }).annualCtc).toBe(441600);
    expect((auditRow?.oldValues as { annualCtc: number }).annualCtc).toBe(357600);

    // Employee sees their own salary; managers and peers do not.
    expect((await as(emp.token).get(`/api/v1/salary/employee/${empId}`)).status).toBe(200);
    expect((await as(mgr.token).get(`/api/v1/salary/employee/${empId}`)).status).toBe(403);
    expect((await as(plain.token).get(`/api/v1/salary/employee/${empId}`)).status).toBe(403);
    expect((await as(emp.token).post('/api/v1/salary', structureBody(empId, '2026-06-01', 99999))).status).toBe(403);

    const list = await as(payAdmin.token).get('/api/v1/salary?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.data.find((e: { _id: string }) => e._id === empId).currentStructure.annualCtc).toBe(441600);
    expect((await as(emp.token).get('/api/v1/salary')).status).toBe(403);
  });

  it('runs payroll end to end: LOP, overtime, adjustment, loan, approval, payment and payslips', async () => {
    const worker = await createEmployeeUser(admin.token, {
      firstName: 'Worker',
      bank: { bankName: 'Test Bank', accountNumber: '123456789012' },
    });
    const empId = worker.employee._id;
    const code = worker.employee.employeeId;
    expect((await as(payAdmin.token).post('/api/v1/salary', structureBody(empId, '2026-01-01', 30000))).status).toBe(201);

    // June 2026: 30 days, 22 working days (Mon-Fri, no holidays).
    const lop = await LeaveTypeModel.findOne({ organizationId: orgId, code: 'LOP' }).lean();
    await LeaveRequestModel.create({
      organizationId: orgId,
      employeeId: empId,
      leaveTypeId: lop!._id,
      startDate: dateOnly('2026-06-10'),
      endDate: dateOnly('2026-06-11'),
      days: 2,
      reason: 'Personal',
      status: 'APPROVED',
    });
    await AttendanceModel.create([
      { organizationId: orgId, employeeId: empId, date: dateOnly('2026-06-15'), status: 'ABSENT' },
      { organizationId: orgId, employeeId: empId, date: dateOnly('2026-06-16'), status: 'PRESENT', overtimeMinutes: 120 },
    ]);
    const bonus = await as(payAdmin.token).post('/api/v1/payroll/adjustments', {
      employeeId: empId,
      month: 6,
      year: 2026,
      kind: 'EARNING',
      category: 'BONUS',
      amount: 5000,
      description: 'Performance bonus',
    });
    expect(bonus.status).toBe(201);
    const loan = await as(payAdmin.token).post('/api/v1/payroll/loans', {
      employeeId: empId,
      type: 'LOAN',
      principal: 3000,
      monthlyInstallment: 2000,
      startMonth: 5,
      startYear: 2026,
    });
    expect(loan.status).toBe(201);
    expect(loan.body.data.outstanding).toBe(3000);

    // Employees cannot touch payroll.
    expect((await as(worker.token).get('/api/v1/payroll')).status).toBe(403);
    expect((await as(worker.token).post('/api/v1/payroll', { month: 6, year: 2026 })).status).toBe(403);

    const created = await as(payAdmin.token).post('/api/v1/payroll', { month: 6, year: 2026 });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.periodKey).toBe('2026-06');
    const runId = created.body.data._id;
    expect((await as(payAdmin.token).post('/api/v1/payroll', { month: 6, year: 2026 })).status).toBe(409);

    const processed = await as(payAdmin.token).post(`/api/v1/payroll/${runId}/process`);
    expect(processed.status).toBe(200);
    expect(processed.body.data.status).toBe('REVIEW');
    expect(processed.body.data.warnings.length).toBeGreaterThan(0); // employees without structures
    expect(processed.body.data.statusHistory.map((h: { status: string }) => h.status)).toEqual(['DRAFT', 'PROCESSING', 'REVIEW']);

    const slip = await PayslipModel.findOne({ payrollId: runId, employeeId: empId }).lean();
    expect(slip).toBeTruthy();
    const line = (lines: { code?: string | null; amount?: number | null }[], c: string) => lines.find((l) => l.code === c)?.amount;
    expect(slip!.unpaidLeaveDays).toBe(2);
    expect(slip!.absentDays).toBe(1);
    expect(slip!.lopDays).toBe(3);
    expect(slip!.payableDays).toBe(27);
    expect(slip!.workingDays).toBe(22);
    expect(slip!.overtimeHours).toBe(2);
    expect(line(slip!.earnings, 'BASIC')).toBe(27000);
    expect(line(slip!.earnings, 'HRA')).toBe(10800);
    // (42000 / (22 × 8)) × 2h × 1.5
    expect(line(slip!.earnings, 'OVERTIME')).toBe(715.91);
    expect(line(slip!.earnings, 'BONUS')).toBe(5000);
    expect(line(slip!.deductions, 'PF')).toBe(1800);
    expect(line(slip!.deductions, 'PT')).toBe(200);
    expect(line(slip!.deductions, 'ESI')).toBeUndefined();
    expect(line(slip!.deductions, 'LOAN')).toBe(2000);
    expect(line(slip!.employerContributions, 'PF_ER')).toBe(1800);
    expect(slip!.grossEarnings).toBe(43515.91);
    expect(slip!.totalDeductions).toBe(4000);
    expect(slip!.netPay).toBe(39515.91);
    expect(slip!.status).toBe('DRAFT');
    expect(slip!.employeeSnapshot?.accountNumberMasked).toMatch(/9012$/);
    expect(JSON.stringify(slip)).not.toContain('123456789012');

    // Adjustment is linked to the run.
    const adj = await as(payAdmin.token).get(`/api/v1/payroll/adjustments/${bonus.body.data._id}`);
    expect(adj.body.data.payrollId).toBe(runId);

    // Draft payslips are invisible to employees.
    const mineDraft = await as(worker.token).get('/api/v1/payslips');
    expect(mineDraft.status).toBe(200);
    expect(mineDraft.body.data).toHaveLength(0);
    expect((await as(worker.token).get(`/api/v1/payslips/${slip!._id}`)).status).toBe(404);

    // Four-eyes: the processor cannot approve while another approver exists.
    const self = await as(payAdmin.token).post(`/api/v1/payroll/${runId}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL');
    const approved = await as(admin.token).post(`/api/v1/payroll/${runId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');

    // Reopen and approve again (APPROVED → REVIEW → APPROVED).
    expect((await as(admin.token).post(`/api/v1/payroll/${runId}/reopen`)).body.data.status).toBe('REVIEW');
    expect((await as(worker.token).get('/api/v1/payslips')).body.data).toHaveLength(0);
    expect((await as(admin.token).post(`/api/v1/payroll/${runId}/approve`)).status).toBe(200);

    // Employee can now see and download their own payslip.
    const mine = await as(worker.token).get('/api/v1/payslips');
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].status).toBe('FINAL');
    expect(mine.body.data[0].netPay).toBe(39515.91);
    const pdf = await as(worker.token).get(`/api/v1/payslips/${slip!._id}/pdf`).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(`payslip-${code}-2026-06.pdf`);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // ...but not someone else's, and not via employeeId filters.
    expect((await as(plain.token).get(`/api/v1/payslips/${slip!._id}`)).status).toBe(403);
    expect((await as(plain.token).get(`/api/v1/payslips/${slip!._id}/pdf`)).status).toBe(403);
    expect((await as(plain.token).get(`/api/v1/payslips?employeeId=${empId}`)).status).toBe(403);
    expect((await as(plain.token).get('/api/v1/payslips?scope=all')).status).toBe(403);
    const hrView = await as(payAdmin.token).get(`/api/v1/payslips?employeeId=${empId}`);
    expect(hrView.body.data).toHaveLength(1);

    // Pay.
    const paid = await as(admin.token).post(`/api/v1/payroll/${runId}/pay`, { paymentDate: '2026-06-30', paymentReference: 'BATCH-0626' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('PAID');
    const paidSlip = await PayslipModel.findById(slip!._id).lean();
    expect(paidSlip!.status).toBe('PAID');
    expect(paidSlip!.paymentReference).toBe('BATCH-0626');
    const loanAfter = await LoanModel.findById(loan.body.data._id).lean();
    expect(loanAfter!.outstanding).toBe(1000);
    expect(loanAfter!.repayments).toHaveLength(1);
    expect(loanAfter!.status).toBe('ACTIVE');
    const note = await NotificationModel.findOne({ organizationId: orgId, type: 'PAYROLL_GENERATED', entityId: slip!._id }).lean();
    expect(note?.link).toBe(`/payslips/${slip!._id}`);
    expect(sentEmails.some((e) => e.to === worker.email && e.template === 'payslip')).toBe(true);
    expect(await AuditLogModel.exists({ action: 'PAYROLL_PAID', recordId: runId })).toBeTruthy();
    expect(await AuditLogModel.exists({ action: 'PAYROLL_APPROVED', recordId: runId })).toBeTruthy();
    expect(await AuditLogModel.exists({ action: 'PAYROLL_PROCESSED', recordId: runId })).toBeTruthy();
    expect(await AuditLogModel.exists({ action: 'PAYROLL_CREATED', recordId: runId })).toBeTruthy();

    // PAID is terminal.
    expect((await as(admin.token).post(`/api/v1/payroll/${runId}/cancel`)).status).toBe(422);
    expect((await as(admin.token).post(`/api/v1/payroll/${runId}/reopen`)).status).toBe(422);
    expect((await as(admin.token).post(`/api/v1/payroll/${runId}/process`)).status).toBe(422);
    // Adjustments of a paid run are locked.
    expect((await as(payAdmin.token).patch(`/api/v1/payroll/adjustments/${bonus.body.data._id}`, { amount: 1 })).status).toBe(422);
    expect((await as(payAdmin.token).delete(`/api/v1/payroll/adjustments/${bonus.body.data._id}`)).status).toBe(422);

    // Exports (masked account only).
    const csv = await as(payAdmin.token).get(`/api/v1/payroll/${runId}/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(code);
    expect(csv.text).toContain('39515.91');
    expect(csv.text).not.toContain('123456789012');
    const xlsx = await as(payAdmin.token).get(`/api/v1/payroll/${runId}/export?format=xlsx`).buffer(true).parse(binary);
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    // Summary.
    const summary = await as(payAdmin.token).get('/api/v1/payroll/summary?year=2026');
    expect(summary.status).toBe(200);
    expect(summary.body.data.months[5].totalNet).toBe(paid.body.data.totalNet);
    expect(summary.body.data.months[5].runs).toBe(1);

    // Run detail & payslip page.
    const detail = await as(payAdmin.token).get(`/api/v1/payroll/${runId}`);
    expect(detail.body.data.payslips.some((s: { employeeId: string }) => s.employeeId === empId)).toBe(true);
    const page = await as(payAdmin.token).get(`/api/v1/payroll/${runId}/payslips?search=Worker`);
    expect(page.body.data).toHaveLength(1);

    // An off-cycle run for the same month is allowed and does not repeat the loan or bonus.
    const off = await as(payAdmin.token).post('/api/v1/payroll', { month: 6, year: 2026, employeeIds: [empId] });
    expect(off.status).toBe(201);
    expect(off.body.data.isOffCycle).toBe(true);
    expect(off.body.data.periodKey).toBeNull();
    const offProcessed = await as(payAdmin.token).post('/api/v1/payroll/process', { payrollId: off.body.data._id });
    expect(offProcessed.status).toBe(200);
    const offSlip = await PayslipModel.findOne({ payrollId: off.body.data._id }).lean();
    expect(line(offSlip!.deductions, 'LOAN')).toBeUndefined();
    expect(line(offSlip!.earnings, 'BONUS')).toBeUndefined();
  });

  it('cancels draft/review runs, freeing the month and hiding payslips', async () => {
    const res = await as(payAdmin.token).post('/api/v1/payroll/process', { month: 7, year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REVIEW');
    const runId = res.body.data._id;
    expect(await PayslipModel.countDocuments({ payrollId: runId })).toBeGreaterThan(0);
    const cancelled = await as(payAdmin.token).post(`/api/v1/payroll/${runId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.periodKey).toBeNull();
    expect(await PayslipModel.countDocuments({ payrollId: runId })).toBe(0);
    expect((await as(payAdmin.token).post('/api/v1/payroll', { month: 7, year: 2026 })).status).toBe(201);
  });

  it('isolates tenants', async () => {
    const other = await registerOrg({ country: 'IN' });
    const emp = await createEmployeeUser(admin.token, { firstName: 'Iso' });
    const runs = await as(admin.token).get('/api/v1/payroll?limit=50');
    const runId = runs.body.data[0]._id;
    const slip = await PayslipModel.findOne({ organizationId: orgId }).lean();

    expect((await as(other.token).get(`/api/v1/payroll/${runId}`)).status).toBe(404);
    expect((await as(other.token).post(`/api/v1/payroll/${runId}/approve`)).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/payslips/${slip!._id}`)).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/salary/employee/${emp.employee._id}`)).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/salary-components/${comps.HRA}`)).status).toBe(404);
    const foreign = await as(other.token).post('/api/v1/salary', structureBody(emp.employee._id, '2026-01-01', 1000));
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('INVALID_REFERENCE');
    expect((await as(other.token).get('/api/v1/payroll')).body.data).toHaveLength(0);
    expect((await as(other.token).get('/api/v1/payslips?scope=all')).body.data).toHaveLength(0);
  });

  it('closing a loan early writes off the outstanding balance', async () => {
    const borrower = await createEmployeeUser(admin.token, { firstName: 'Borrower' });
    const loan = await as(payAdmin.token).post('/api/v1/payroll/loans', {
      employeeId: borrower.employee._id,
      type: 'ADVANCE',
      principal: 1500,
      monthlyInstallment: 500,
      startMonth: 1,
      startYear: 2031,
    });
    expect(loan.status).toBe(201);
    expect(loan.body.data.outstanding).toBe(1500);

    const closed = await as(payAdmin.token).post(`/api/v1/payroll/loans/${loan.body.data._id}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', outstanding: 0, writtenOff: 1500 });
    const fetched = await as(payAdmin.token).get(`/api/v1/payroll/loans/${loan.body.data._id}`);
    expect(fetched.body.data).toMatchObject({ outstanding: 0, writtenOff: 1500 });
    expect((await as(payAdmin.token).post(`/api/v1/payroll/loans/${loan.body.data._id}/close`)).status).toBe(422);
  });
});
