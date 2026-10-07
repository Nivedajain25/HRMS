import { beforeAll, describe, expect, it } from 'vitest';
import { AuditLogModel, NotificationModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg } from '../helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

describe('Expenses', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let manager: Awaited<ReturnType<typeof createEmployeeUser>>;
  let emp: Awaited<ReturnType<typeof createEmployeeUser>>;
  let finance: Awaited<ReturnType<typeof createEmployeeUser>>;
  let outsider: Awaited<ReturnType<typeof createEmployeeUser>>;

  const claim = (extra: Record<string, unknown> = {}) => ({
    category: 'TRAVEL',
    amount: 120.5,
    currency: 'usd',
    date: '2024-05-10',
    description: 'Taxi to client site',
    merchant: 'City Cabs',
    ...extra,
  });

  const receiptFor = async (token: string) => {
    const res = await as(token).upload('/api/v1/files').field('context', 'EXPENSE').attach('file', PDF, 'receipt.pdf');
    expect(res.status).toBe(201);
    return res.body.data._id as string;
  };

  beforeAll(async () => {
    admin = await registerOrg();
    manager = await createEmployeeUser(admin.token, { firstName: 'Mgr', roles: ['manager'] });
    emp = await createEmployeeUser(admin.token, { firstName: 'Emp', managerId: manager.employee._id });
    finance = await createEmployeeUser(admin.token, { firstName: 'Fin', roles: ['finance'] });
    outsider = await createEmployeeUser(admin.token, { firstName: 'Out' });
  });

  it('runs submit → manager approve → finance approve → pay', async () => {
    const receiptFileId = await receiptFor(emp.token);
    const created = await as(emp.token).post('/api/v1/expenses', claim({ receiptFileId }));
    expect(created.status).toBe(201);
    const exp = created.body.data;
    expect(exp.expenseNumber).toMatch(/^EXP-\d{4}$/);
    expect(exp.status).toBe('SUBMITTED');
    expect(exp.currency).toBe('USD');
    expect(exp.currentApproverType).toBe('MANAGER');
    expect(exp.approvalSteps.map((s: { approverType: string }) => s.approverType)).toEqual(['MANAGER', 'FINANCE']);
    expect(await AuditLogModel.exists({ action: 'EXPENSE_SUBMITTED', recordId: exp._id })).toBeTruthy();
    expect(await NotificationModel.exists({ type: 'EXPENSE_APPROVAL', entityId: exp._id })).toBeTruthy();

    // IDOR: unrelated employees cannot see it or its receipt; the manager can.
    expect((await as(outsider.token).get(`/api/v1/expenses/${exp._id}`)).status).toBe(403);
    expect((await as(outsider.token).get(`/api/v1/files/${receiptFileId}`)).status).toBe(403);
    expect((await as(manager.token).get(`/api/v1/files/${receiptFileId}`)).status).toBe(200);

    // Finance cannot act on the manager step... but the queue shows it to the manager.
    const queue = await as(manager.token).get('/api/v1/expenses?scope=approvals');
    expect(queue.body.data.map((e: { _id: string }) => e._id)).toContain(exp._id);

    const m = await as(manager.token).post(`/api/v1/expenses/${exp._id}/approve`, { comment: 'OK' });
    expect(m.status).toBe(200);
    expect(m.body.data.status).toBe('PENDING_APPROVAL');
    expect(m.body.data.currentApproverType).toBe('FINANCE');
    // The employee is told about the manager's approval straight away.
    expect(await NotificationModel.exists({ type: 'EXPENSE_APPROVAL', entityId: exp._id, message: /approved by .* now waiting for approval from Finance$/ })).toBeTruthy();
    // Manager cannot approve the finance step.
    expect((await as(manager.token).post(`/api/v1/expenses/${exp._id}/approve`, {})).status).toBe(403);
    // Not payable before final approval.
    expect((await as(finance.token).post(`/api/v1/expenses/${exp._id}/pay`, { paidDate: '2024-05-20' })).status).toBe(422);

    const finQueue = await as(finance.token).get('/api/v1/expenses?scope=approvals');
    expect(finQueue.body.data.map((e: { _id: string }) => e._id)).toContain(exp._id);
    const f = await as(finance.token).post(`/api/v1/expenses/${exp._id}/approve`, {});
    expect(f.body.data.status).toBe('APPROVED');

    const payable = await as(finance.token).get('/api/v1/expenses?scope=payable');
    expect(payable.body.data.map((e: { _id: string }) => e._id)).toContain(exp._id);
    expect((await as(emp.token).get('/api/v1/expenses?scope=payable')).status).toBe(403);

    const paid = await as(finance.token).post(`/api/v1/expenses/${exp._id}/pay`, { paidDate: '2024-05-20', paymentReference: 'TRX-1' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('PAID');
    expect(paid.body.data.paymentReference).toBe('TRX-1');
    expect(await AuditLogModel.exists({ action: 'EXPENSE_PAID', recordId: exp._id })).toBeTruthy();
    // Paid is terminal.
    expect((await as(finance.token).post(`/api/v1/expenses/${exp._id}/pay`, { paidDate: '2024-05-21' })).status).toBe(422);
    expect((await as(emp.token).post(`/api/v1/expenses/${exp._id}/cancel`)).status).toBe(422);
  });

  it('rejects with a reason; rejected expenses cannot be paid', async () => {
    const exp = (await as(emp.token).post('/api/v1/expenses', claim({ amount: 999 }))).body.data;
    expect((await as(manager.token).post(`/api/v1/expenses/${exp._id}/reject`, {})).status).toBe(400);
    const rej = await as(manager.token).post(`/api/v1/expenses/${exp._id}/reject`, { reason: 'Personal trip' });
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe('REJECTED');
    expect(rej.body.data.rejectionReason).toBe('Personal trip');
    const pay = await as(finance.token).post(`/api/v1/expenses/${exp._id}/pay`, { paidDate: '2024-05-20' });
    expect(pay.status).toBe(422);
    expect(pay.body.code).toBe('INVALID_TRANSITION');
    expect((await as(finance.token).post(`/api/v1/expenses/${exp._id}/approve`, {})).status).toBe(422);
  });

  it('never lets anyone approve their own expense', async () => {
    // Plain employee: no approve permission at all.
    const own = (await as(emp.token).post('/api/v1/expenses', claim())).body.data;
    expect((await as(emp.token).post(`/api/v1/expenses/${own._id}/approve`, {})).status).toBe(403);
    // Manager (with expense:approve) submitting their own claim cannot approve it.
    const mgrClaim = (await as(manager.token).post('/api/v1/expenses', claim())).body.data;
    expect((await as(manager.token).post(`/api/v1/expenses/${mgrClaim._id}/approve`, {})).status).toBe(403);
    // Finance cannot pay their own claim even once approved.
    const finClaim = (await as(finance.token).post('/api/v1/expenses', claim())).body.data;
    const fq = await as(finance.token).get('/api/v1/expenses?scope=approvals');
    expect(fq.body.data.map((e: { _id: string }) => e._id)).not.toContain(finClaim._id);
    expect((await as(finance.token).post(`/api/v1/expenses/${finClaim._id}/approve`, {})).status).toBe(403);
    const fromAdmin = await as(admin.token).post(`/api/v1/expenses/${finClaim._id}/approve`, {});
    expect(fromAdmin.body.data.status).toBe('APPROVED');
    expect((await as(finance.token).post(`/api/v1/expenses/${finClaim._id}/pay`, { paidDate: '2024-05-20' })).status).toBe(403);
  });

  it('supports drafts, partial edits, submit and cancel', async () => {
    const draft = await as(emp.token).post('/api/v1/expenses', claim({ submit: false, category: 'MEALS' }));
    expect(draft.body.data.status).toBe('DRAFT');
    const id = draft.body.data._id;
    const edit = await as(emp.token).patch(`/api/v1/expenses/${id}`, { amount: 42 });
    expect(edit.status).toBe(200);
    expect(edit.body.data.amount).toBe(42);
    expect(edit.body.data.category).toBe('MEALS');
    expect((await as(manager.token).patch(`/api/v1/expenses/${id}`, { amount: 1 })).status).toBe(403);

    const sub = await as(emp.token).post(`/api/v1/expenses/${id}/submit`);
    expect(sub.body.data.status).toBe('SUBMITTED');
    expect((await as(emp.token).patch(`/api/v1/expenses/${id}`, { amount: 43 })).status).toBe(422);
    const cancel = await as(emp.token).post(`/api/v1/expenses/${id}/cancel`);
    expect(cancel.body.data.status).toBe('CANCELLED');
  });

  it('validates receipts, dates and on-behalf submissions', async () => {
    const othersReceipt = await receiptFor(outsider.token);
    const bad = await as(emp.token).post('/api/v1/expenses', claim({ receiptFileId: othersReceipt }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_REFERENCE');
    expect((await as(emp.token).post('/api/v1/expenses', claim({ date: '2999-01-01' }))).status).toBe(400);
    expect((await as(emp.token).post('/api/v1/expenses', claim({ employeeId: outsider.employee._id }))).status).toBe(403);
    const onBehalf = await as(admin.token).post('/api/v1/expenses', claim({ employeeId: outsider.employee._id }));
    expect(onBehalf.status).toBe(201);
    expect(onBehalf.body.data.employeeId._id).toBe(outsider.employee._id);

    const foreign = await registerOrg();
    expect((await as(foreign.token).get(`/api/v1/expenses/${onBehalf.body.data._id}`)).status).toBe(404);
  });

  it('scopes lists and summaries', async () => {
    const mine = await as(emp.token).get('/api/v1/expenses?limit=100');
    expect(mine.body.data.every((e: { employeeId: { _id: string } }) => e.employeeId._id === emp.employee._id)).toBe(true);
    expect((await as(emp.token).get('/api/v1/expenses?scope=all')).status).toBe(403);
    const team = await as(manager.token).get('/api/v1/expenses?scope=team&limit=100');
    expect(team.body.data.length).toBeGreaterThan(0);
    expect(team.body.data.every((e: { employeeId: { _id: string } }) => e.employeeId._id === emp.employee._id)).toBe(true);
    const all = await as(finance.token).get('/api/v1/expenses?scope=all&status=PAID');
    expect(all.body.data.length).toBe(1);

    const summary = await as(finance.token).get('/api/v1/expenses/summary?from=2024-01-01&to=2024-12-31');
    expect(summary.status).toBe(200);
    const paid = summary.body.data.byStatus.find((s: { status: string }) => s.status === 'PAID');
    expect(paid).toMatchObject({ currency: 'USD', count: 1, total: 120.5 });
    expect(summary.body.data.byCategory.some((c: { category: string }) => c.category === 'TRAVEL')).toBe(true);
  });

  it('removes the receipt of a draft with receiptFileId: null', async () => {
    const receiptFileId = await receiptFor(emp.token);
    const draft = await as(emp.token).post('/api/v1/expenses', claim({ submit: false, receiptFileId }));
    expect(draft.status).toBe(201);
    expect(draft.body.data.receiptUrl).toBe(`/api/v1/files/${receiptFileId}`);
    const id = draft.body.data._id;
    const cleared = await as(emp.token).patch(`/api/v1/expenses/${id}`, { receiptFileId: null, merchant: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.receiptFileId ?? null).toBeNull();
    expect(cleared.body.data.receiptUrl).toBeNull();
    expect(cleared.body.data.merchant ?? null).toBeNull();
    expect(cleared.body.data.amount).toBe(120.5);
    // Required fields cannot be cleared.
    expect((await as(emp.token).patch(`/api/v1/expenses/${id}`, { description: null })).status).toBe(400);
    await as(emp.token).post(`/api/v1/expenses/${id}/cancel`);
  });

  it('lets an expense:pay-only role act on the FINANCE step but never on the MANAGER step', async () => {
    const role = await as(admin.token).post('/api/v1/roles', { name: `Payer ${Date.now()}`, permissions: ['expense:pay', 'expense:read'] });
    expect(role.status).toBe(201);
    const payer = await createEmployeeUser(admin.token, { firstName: 'Payer', roleIds: [role.body.data._id] });

    const exp = (await as(emp.token).post('/api/v1/expenses', claim({ amount: 55 }))).body.data;
    expect(exp.currentApproverType).toBe('MANAGER');
    // MANAGER step: the route admits the payer, the approval engine refuses.
    expect((await as(payer.token).post(`/api/v1/expenses/${exp._id}/approve`, {})).status).toBe(403);
    expect((await as(payer.token).post(`/api/v1/expenses/${exp._id}/reject`, { reason: 'No' })).status).toBe(403);

    expect((await as(manager.token).post(`/api/v1/expenses/${exp._id}/approve`, {})).body.data.currentApproverType).toBe('FINANCE');
    const queue = await as(payer.token).get('/api/v1/expenses?scope=approvals');
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((e: { _id: string }) => e._id)).toContain(exp._id);
    const approved = await as(payer.token).post(`/api/v1/expenses/${exp._id}/approve`, { comment: 'Budget OK' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');

    // Rejecting on the FINANCE step also works for the payer.
    const second = (await as(emp.token).post('/api/v1/expenses', claim({ amount: 66 }))).body.data;
    await as(manager.token).post(`/api/v1/expenses/${second._id}/approve`, {});
    const rej = await as(payer.token).post(`/api/v1/expenses/${second._id}/reject`, { reason: 'Over budget' });
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe('REJECTED');

    // Roles without either permission are still refused at the route.
    const third = (await as(emp.token).post('/api/v1/expenses', claim({ amount: 77 }))).body.data;
    expect((await as(outsider.token).post(`/api/v1/expenses/${third._id}/approve`, {})).status).toBe(403);
  });
});
