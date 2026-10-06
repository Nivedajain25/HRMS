import request from 'supertest';
import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, EmployeeHistoryModel, EmployeeModel, PayrollModel, PayslipModel, UserModel } from '../../src/models';
import { PASSWORD, as, createEmployeeUser, getApp, registerOrg } from '../helpers';

describe('Offboarding', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let hr: Awaited<ReturnType<typeof createEmployeeUser>>;
  let manager: Awaited<ReturnType<typeof createEmployeeUser>>;
  let orgId: Types.ObjectId;

  beforeAll(async () => {
    admin = await registerOrg();
    orgId = new Types.ObjectId(String(admin.user.organization._id));
    hr = await createEmployeeUser(admin.token, { firstName: 'Hr', roles: ['hr_admin'] });
    manager = await createEmployeeUser(admin.token, { firstName: 'Mgr', roles: ['manager'] });
  });

  const advance = (id: string, body: Record<string, unknown> = {}) => as(hr.token).post(`/api/v1/offboarding/${id}/advance`, body);

  it('runs a resignation end-to-end with asset, clearance and final payroll gates', async () => {
    const emp = await createEmployeeUser(admin.token, { firstName: 'Leaver', managerId: manager.employee._id });
    const asset = await as(hr.token).post('/api/v1/assets', { name: 'ThinkPad', category: 'LAPTOP' });
    await as(hr.token).post(`/api/v1/assets/${asset.body.data._id}/assign`, { employeeId: emp.employee._id, assignedDate: '2024-02-01' });

    // Validation and permission checks.
    const early = await as(emp.token).post('/api/v1/offboarding', {
      employeeId: emp.employee._id,
      exitType: 'RESIGNATION',
      reason: 'Relocating',
      requestDate: '2024-09-01',
      lastWorkingDate: '2024-08-01',
    });
    expect(early.status).toBe(400);
    const notResignation = await as(emp.token).post('/api/v1/offboarding', {
      employeeId: emp.employee._id,
      exitType: 'TERMINATION',
      reason: 'x',
      requestDate: '2024-09-01',
      lastWorkingDate: '2024-09-30',
    });
    expect(notResignation.status).toBe(403);
    const forOther = await as(emp.token).post('/api/v1/offboarding', {
      employeeId: manager.employee._id,
      exitType: 'RESIGNATION',
      reason: 'x',
      requestDate: '2024-09-01',
      lastWorkingDate: '2024-09-30',
    });
    expect(forOther.status).toBe(403);

    // Self-resignation.
    const body = { employeeId: emp.employee._id, exitType: 'RESIGNATION', reason: 'Relocating', requestDate: '2024-09-01', lastWorkingDate: '2024-09-30' };
    const created = await as(emp.token).post('/api/v1/offboarding', body);
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect(created.body.data.status).toBe('EXIT_REQUEST');
    expect(created.body.data.clearance.map((c: { department: string }) => c.department)).toEqual(['IT', 'Finance', 'Admin', 'HR', 'Manager']);
    expect(created.body.data.assets).toHaveLength(1);
    expect((await EmployeeModel.findById(emp.employee._id).lean())?.employmentStatus).toBe('NOTICE_PERIOD');
    expect(await EmployeeHistoryModel.exists({ employeeId: emp.employee._id, field: 'status', newValue: 'NOTICE_PERIOD' })).toBeTruthy();
    expect((await as(hr.token).post('/api/v1/offboarding', body)).status).toBe(409);

    // Visibility: employee (own), manager (team), HR (all); the employee cannot advance.
    expect((await as(emp.token).get(`/api/v1/offboarding/${id}`)).status).toBe(200);
    expect((await as(manager.token).get('/api/v1/offboarding')).body.data.map((o: { _id: string }) => o._id)).toContain(id);
    expect((await as(emp.token).post(`/api/v1/offboarding/${id}/advance`, {})).status).toBe(403);

    expect((await advance(id, { note: 'Accepted' })).body.data.status).toBe('NOTICE_PERIOD');
    expect((await advance(id)).body.data.status).toBe('ASSET_RETURN');

    // Asset gate.
    const blocked = await advance(id);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('ASSETS_NOT_RETURNED');
    expect(blocked.body.message).toContain('ThinkPad');
    // Cannot cancel past the notice period.
    expect((await as(hr.token).post(`/api/v1/offboarding/${id}/cancel`, {})).status).toBe(422);
    await as(hr.token).post(`/api/v1/assets/${asset.body.data._id}/return`, { returnedDate: '2024-09-25', condition: 'GOOD' });
    const toClearance = await advance(id);
    expect(toClearance.body.data.status).toBe('CLEARANCE');
    expect(toClearance.body.data.assetsReturned).toBe(true);

    // Clearance gate.
    const partial = await advance(id, { clearance: [{ department: 'IT', cleared: true }] });
    expect(partial.status).toBe(422);
    expect(partial.body.code).toBe('CLEARANCE_PENDING');
    const cleared = await advance(id, {
      clearance: ['IT', 'Finance', 'Admin', 'HR', 'Manager'].map((department) => ({ department, cleared: true })),
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.status).toBe('FINAL_PAYROLL');

    // Final payroll gate: no approved payslip yet.
    const noPayroll = await advance(id);
    expect(noPayroll.status).toBe(422);
    expect(noPayroll.body.code).toBe('FINAL_PAYROLL_PENDING');
    // A foreign payroll id is rejected.
    const foreign = await registerOrg();
    const foreignRun = await PayrollModel.create({
      organizationId: new Types.ObjectId(String(foreign.user.organization._id)),
      month: 9,
      year: 2024,
      periodStart: new Date('2024-09-01'),
      periodEnd: new Date('2024-09-30'),
      currency: 'USD',
      status: 'APPROVED',
    });
    expect((await advance(id, { finalPayrollId: String(foreignRun._id) })).status).toBe(400);

    const run = await PayrollModel.create({
      organizationId: orgId,
      month: 9,
      year: 2024,
      periodStart: new Date('2024-09-01'),
      periodEnd: new Date('2024-09-30'),
      currency: 'USD',
      status: 'APPROVED',
      isOffCycle: true,
      employeeIds: [emp.employee._id],
    });
    await PayslipModel.create({
      organizationId: orgId,
      payrollId: run._id,
      employeeId: emp.employee._id,
      month: 9,
      year: 2024,
      currency: 'USD',
      status: 'FINAL',
      grossEarnings: 5000,
      totalDeductions: 500,
      netPay: 4500,
    });
    const toInterview = await advance(id);
    expect(toInterview.status).toBe(200);
    expect(toInterview.body.data.status).toBe('EXIT_INTERVIEW');
    expect(toInterview.body.data.finalPayrollId._id).toBe(String(run._id));

    const interviewed = await advance(id, { exitInterview: { reasonForLeaving: 'Relocation', rating: 4, wouldRecommend: true, feedback: 'Great team' } });
    expect(interviewed.body.data.status).toBe('DEACTIVATION');
    expect(interviewed.body.data.exitInterview).toMatchObject({ reasonForLeaving: 'Relocation', rating: 4, wouldRecommend: true });

    // Completion exits the employee and locks the account.
    const done = await advance(id, { note: 'All done' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    expect(done.body.data.timeline.map((t: { status: string }) => t.status)).toEqual([
      'EXIT_REQUEST',
      'NOTICE_PERIOD',
      'ASSET_RETURN',
      'CLEARANCE',
      'FINAL_PAYROLL',
      'EXIT_INTERVIEW',
      'DEACTIVATION',
      'COMPLETED',
    ]);
    const exited = await EmployeeModel.findById(emp.employee._id).lean();
    expect(exited?.employmentStatus).toBe('EXITED');
    expect(exited?.exitDate?.toISOString().slice(0, 10)).toBe('2024-09-30');
    expect(await EmployeeHistoryModel.exists({ employeeId: emp.employee._id, field: 'status', newValue: 'EXITED' })).toBeTruthy();
    expect((await UserModel.findOne({ email: emp.email }).lean())?.status).toBe('INACTIVE');
    expect(await AuditLogModel.exists({ action: 'EMPLOYEE_UPDATED', recordId: emp.employee._id })).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ action: 'OFFBOARDING_UPDATED', recordId: id })).toBeGreaterThanOrEqual(8);

    expect((await as(emp.token).get('/api/v1/auth/me')).status).toBe(401);
    const login = await request(getApp()).post('/api/v1/auth/login').send({ email: emp.email, password: PASSWORD });
    expect(login.status).not.toBe(200);
    expect((await advance(id)).status).toBe(422);
  });

  it('cancels before asset return and restores the employment status', async () => {
    const emp = await createEmployeeUser(admin.token, { firstName: 'Stayer', managerId: manager.employee._id });
    const created = await as(hr.token).post('/api/v1/offboarding', {
      employeeId: emp.employee._id,
      exitType: 'TERMINATION',
      reason: 'Restructuring',
      requestDate: '2024-09-01',
      lastWorkingDate: '2024-10-31',
    });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    // The employee may not withdraw an HR-initiated termination.
    expect((await as(emp.token).post(`/api/v1/offboarding/${id}/cancel`, {})).status).toBe(403);
    // Unrelated employees cannot view it.
    const other = await createEmployeeUser(admin.token, { firstName: 'Nosy' });
    expect((await as(other.token).get(`/api/v1/offboarding/${id}`)).status).toBe(403);

    await advance(id);
    const cancelled = await as(hr.token).post(`/api/v1/offboarding/${id}/cancel`, { note: 'Decision reversed' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect((await EmployeeModel.findById(emp.employee._id).lean())?.employmentStatus).toBe('ACTIVE');
    expect((await advance(id)).status).toBe(422);
    // A new offboarding can be started after cancellation; the employee can withdraw their own resignation.
    const again = await as(emp.token).post('/api/v1/offboarding', {
      employeeId: emp.employee._id,
      exitType: 'RESIGNATION',
      reason: 'New offer',
      requestDate: '2024-11-01',
      lastWorkingDate: '2024-11-30',
    });
    expect(again.status).toBe(201);
    expect((await as(emp.token).post(`/api/v1/offboarding/${again.body.data._id}/cancel`, {})).body.data.status).toBe('CANCELLED');

    // Tenant isolation.
    const foreign = await registerOrg();
    expect((await as(foreign.token).get(`/api/v1/offboarding/${id}`)).status).toBe(404);
    expect((await as(foreign.token).post(`/api/v1/offboarding/${id}/advance`, {})).status).toBe(404);
  });
});
