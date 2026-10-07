import { beforeAll, describe, expect, it } from 'vitest';
import { AttendanceModel, AuditLogModel, EmployeeModel, HolidayModel, NotificationModel, UserModel } from '../../src/models';
import { dateOnly } from '../../src/utils/dates';
import { as, createEmployeeUser, registerOrg } from '../helpers';

/**
 * All requests use dates in NEXT calendar year so they are always in the
 * future (no backdating limits) and never cross a year boundary.
 */
const Y = new Date().getUTCFullYear() + 1;
const CURRENT_YEAR = Y - 1;
const firstMonday = (() => {
  const d = new Date(Date.UTC(Y, 0, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();
/** Date key of Monday of week `n` (1..40) plus `offset` days. */
const day = (week: number, offset = 0) => {
  const d = new Date(firstMonday);
  d.setUTCDate(d.getUTCDate() + 7 * week + offset);
  return d.toISOString().slice(0, 10);
};

type Emp = Awaited<ReturnType<typeof createEmployeeUser>>;
interface BalanceRow {
  leaveType: { _id: string; code: string };
  allocated: number;
  opening: number;
  used: number;
  pending: number;
  remaining: number;
  carryForward: number;
  adjusted: number;
  encashed: number;
}

const userIdOf = async (employeeId: string) => (await EmployeeModel.findById(employeeId).select('userId organizationId').lean())!;

const balanceOf = async (token: string, code: string, year = Y, employeeId?: string) => {
  const res = await as(token).get(`/api/v1/leaves/balances?year=${year}${employeeId ? `&employeeId=${employeeId}` : ''}`);
  expect(res.status).toBe(200);
  const row = (res.body.data as BalanceRow[]).find((b) => b.leaveType.code === code);
  expect(row, `balance row ${code}`).toBeTruthy();
  return row!;
};

describe('Leave management', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let mgr: Emp;
  let types: Record<string, string>;

  const newEmp = (extra: Record<string, unknown> = {}) => createEmployeeUser(admin.token, { managerId: mgr.employee._id, ...extra });
  const apply = (token: string, body: Record<string, unknown>) =>
    as(token).post('/api/v1/leaves', { leaveTypeId: types.CL, reason: 'Personal work', ...body });

  beforeAll(async () => {
    admin = await registerOrg();
    mgr = await createEmployeeUser(admin.token, { firstName: 'Manager', roles: ['manager'] });
    const res = await as(admin.token).get('/api/v1/leave-types/all');
    expect(res.status).toBe(200);
    types = Object.fromEntries((res.body.data as { code: string; _id: string }[]).map((t) => [t.code, t._id]));
    expect(types.CL && types.LOP && types.EL && types.ML && types.PTL).toBeTruthy();
  });

  it('apply → manager approves: pending moves to used, notifications and audit recorded', async () => {
    const emp = await newEmp({ firstName: 'Alice' });
    const created = await apply(emp.token, { startDate: day(1, 1), endDate: day(1, 2) });
    expect(created.status).toBe(201);
    const leave = created.body.data;
    expect(leave.status).toBe('SUBMITTED');
    expect(leave.days).toBe(2);
    expect(leave.currentApproverType).toBe('MANAGER');
    expect(leave.leaveTypeId.code).toBe('CL');
    expect(leave.employeeId.firstName).toBe('Alice');

    let bal = await balanceOf(emp.token, 'CL');
    expect(bal).toMatchObject({ allocated: 12, pending: 2, used: 0, remaining: 10 });

    const mgrUser = await userIdOf(mgr.employee._id);
    expect(await NotificationModel.exists({ userId: mgrUser.userId, type: 'LEAVE_SUBMITTED', entityId: leave._id })).toBeTruthy();

    const queue = await as(mgr.token).get('/api/v1/leaves?scope=approvals');
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((l: { _id: string }) => l._id)).toContain(leave._id);

    const approved = await as(mgr.token).post(`/api/v1/leaves/${leave._id}/approve`, { comment: 'Enjoy' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.approvalSteps[0]).toMatchObject({ status: 'APPROVED', comment: 'Enjoy' });

    bal = await balanceOf(emp.token, 'CL');
    expect(bal).toMatchObject({ pending: 0, used: 2, remaining: 10 });

    const empUser = await userIdOf(emp.employee._id);
    expect(await NotificationModel.exists({ userId: empUser.userId, type: 'LEAVE_APPROVED', entityId: leave._id })).toBeTruthy();
    const actions = (await AuditLogModel.find({ recordId: leave._id }).lean()).map((a) => a.action).sort();
    expect(actions).toEqual(['LEAVE_APPROVED', 'LEAVE_SUBMITTED']);

    // Invalid transition: an approved leave cannot be approved or rejected again.
    const again = await as(mgr.token).post(`/api/v1/leaves/${leave._id}/reject`, { reason: 'Changed my mind' });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('INVALID_TRANSITION');
  });

  it('reject releases the reservation; approving a rejected leave is an invalid transition', async () => {
    const emp = await newEmp();
    const { body } = await apply(emp.token, { startDate: day(2), endDate: day(2, 2) });
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(3);
    const rejected = await as(mgr.token).post(`/api/v1/leaves/${body.data._id}/reject`, { reason: 'Release deadline' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Release deadline' });
    expect(await balanceOf(emp.token, 'CL')).toMatchObject({ pending: 0, used: 0, remaining: 12 });
    const empUser = await userIdOf(emp.employee._id);
    expect(await NotificationModel.exists({ userId: empUser.userId, type: 'LEAVE_REJECTED' })).toBeTruthy();
    expect(await AuditLogModel.exists({ recordId: body.data._id, action: 'LEAVE_REJECTED' })).toBeTruthy();

    const approve = await as(mgr.token).post(`/api/v1/leaves/${body.data._id}/approve`, {});
    expect(approve.status).toBe(422);
    expect(approve.body.code).toBe('INVALID_TRANSITION');
  });

  it('employees cannot approve their own or others\' leave; managers of other teams cannot approve', async () => {
    const emp = await newEmp();
    const peer = await newEmp();
    const { body } = await apply(emp.token, { startDate: day(3), endDate: day(3) });
    const id = body.data._id;

    expect((await as(emp.token).post(`/api/v1/leaves/${id}/approve`, {})).status).toBe(403);
    expect((await as(peer.token).post(`/api/v1/leaves/${id}/approve`, {})).status).toBe(403);

    const otherMgr = await createEmployeeUser(admin.token, { firstName: 'OtherMgr', roles: ['manager'] });
    await createEmployeeUser(admin.token, { managerId: otherMgr.employee._id });
    const res = await as(otherMgr.token).post(`/api/v1/leaves/${id}/approve`, {});
    expect(res.status).toBe(403);
    // Not visible to them either.
    expect((await as(otherMgr.token).get(`/api/v1/leaves/${id}`)).status).toBe(403);
    expect((await as(peer.token).get(`/api/v1/leaves/${id}`)).status).toBe(403);

    // A manager applying for themselves cannot approve their own request (HR must).
    const own = await apply(mgr.token, { startDate: day(3), endDate: day(3) });
    expect(own.status).toBe(201);
    expect((await as(mgr.token).post(`/api/v1/leaves/${own.body.data._id}/approve`, {})).status).toBe(403);
  });

  it('cancelling approved leave restores the balance and clears system LEAVE attendance', async () => {
    const emp = await newEmp();
    const { body } = await apply(emp.token, { startDate: day(4), endDate: day(4, 1) });
    const id = body.data._id;
    await as(mgr.token).post(`/api/v1/leaves/${id}/approve`, {});
    expect((await balanceOf(emp.token, 'CL')).used).toBe(2);

    const { organizationId } = await userIdOf(emp.employee._id);
    await AttendanceModel.create({ organizationId, employeeId: emp.employee._id, date: dateOnly(day(4)), status: 'LEAVE', source: 'SYSTEM' });

    const cancelled = await as(emp.token).post(`/api/v1/leaves/${id}/cancel`, { reason: 'Plans changed' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Plans changed' });
    expect(await balanceOf(emp.token, 'CL')).toMatchObject({ used: 0, pending: 0, remaining: 12 });
    expect(await AttendanceModel.countDocuments({ employeeId: emp.employee._id, date: dateOnly(day(4)) })).toBe(0);
    expect(await AuditLogModel.exists({ recordId: id, action: 'LEAVE_CANCELLED' })).toBeTruthy();

    // Cancelled is terminal.
    const again = await as(emp.token).post(`/api/v1/leaves/${id}/cancel`, {});
    expect(again.status).toBe(422);

    // Pending cancel releases the reservation; peers cannot cancel.
    const pending = await apply(emp.token, { startDate: day(5), endDate: day(5) });
    const peer = await newEmp();
    expect((await as(peer.token).post(`/api/v1/leaves/${pending.body.data._id}/cancel`, {})).status).toBe(403);
    expect((await as(emp.token).post(`/api/v1/leaves/${pending.body.data._id}/cancel`, {})).status).toBe(200);
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(0);
  });

  it('rejects overlapping requests; half-day sessions may share a date', async () => {
    const emp = await newEmp();
    expect((await apply(emp.token, { startDate: day(6), endDate: day(6, 2) })).status).toBe(201);
    const overlap = await apply(emp.token, { startDate: day(6, 2), endDate: day(6, 3) });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('LEAVE_OVERLAP');

    const first = await apply(emp.token, { startDate: day(7), endDate: day(7), halfDay: true, halfDaySession: 'FIRST_HALF' });
    expect(first.status).toBe(201);
    expect(first.body.data.days).toBe(0.5);
    const second = await apply(emp.token, { startDate: day(7), endDate: day(7), halfDay: true, halfDaySession: 'SECOND_HALF' });
    expect(second.status).toBe(201);
    const dup = await apply(emp.token, { startDate: day(7), endDate: day(7), halfDay: true, halfDaySession: 'SECOND_HALF' });
    expect(dup.status).toBe(409);
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(4);
  });

  it('validates balance, working days, year span, half-day policy and gender applicability', async () => {
    const emp = await newEmp();
    // 3 working weeks = 15 days > 12 CL
    const tooMany = await apply(emp.token, { startDate: day(8), endDate: day(10, 4) });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.code).toBe('INSUFFICIENT_BALANCE');

    const weekend = await apply(emp.token, { startDate: day(8, 5), endDate: day(8, 6) });
    expect(weekend.status).toBe(400);
    expect(weekend.body.code).toBe('NO_WORKING_DAYS');

    const span = await apply(emp.token, { startDate: `${Y}-12-30`, endDate: `${Y + 1}-01-02` });
    expect(span.status).toBe(400);
    expect(span.body.code).toBe('LEAVE_SPANS_YEARS');

    const halfMl = await apply(emp.token, { leaveTypeId: types.ML, startDate: day(8), endDate: day(8), halfDay: true });
    expect(halfMl.status).toBe(400);
    expect(halfMl.body.code).toBe('HALF_DAY_NOT_ALLOWED');

    // Test employees are FEMALE; paternity leave is MALE-only.
    const ptl = await apply(emp.token, { leaveTypeId: types.PTL, startDate: day(8), endDate: day(8) });
    expect(ptl.status).toBe(422);
    expect(ptl.body.code).toBe('LEAVE_TYPE_NOT_APPLICABLE');

    // Maternity leave requires a document.
    const ml = await apply(emp.token, { leaveTypeId: types.ML, startDate: day(8), endDate: day(8, 1) });
    expect(ml.status).toBe(422);
    expect(ml.body.code).toBe('DOCUMENT_REQUIRED');

    const bogusAttachment = await apply(emp.token, { startDate: day(8), endDate: day(8), attachmentId: '64b000000000000000000001' });
    expect(bogusAttachment.status).toBe(400);
    expect(bogusAttachment.body.code).toBe('INVALID_ATTACHMENT');
  });

  it('holidays are excluded from the day count and preview explains the impact', async () => {
    const emp = await newEmp();
    const { organizationId } = await userIdOf(emp.employee._id);
    await HolidayModel.create({ organizationId, name: 'Founders Day', date: dateOnly(day(9, 2)), type: 'COMPANY' });

    const preview = await as(emp.token).post('/api/v1/leaves/preview', { leaveTypeId: types.CL, startDate: day(9), endDate: day(9, 6), reason: 'x' });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ days: 4, balance: 12, balanceAfter: 8, warnings: [] });
    expect(preview.body.data.holidays).toEqual([{ date: day(9, 2), name: 'Founders Day' }]);
    expect(preview.body.data.weekOffs).toEqual([day(9, 5), day(9, 6)]);

    const warn = await as(emp.token).post('/api/v1/leaves/preview', { leaveTypeId: types.CL, startDate: day(11), endDate: day(13, 4), reason: 'x' });
    expect(warn.body.data.warnings.map((w: { code: string }) => w.code)).toContain('INSUFFICIENT_BALANCE');

    const created = await apply(emp.token, { startDate: day(9), endDate: day(9, 6) });
    expect(created.status).toBe(201);
    expect(created.body.data.days).toBe(4);
  });

  it('preview works without a reason and excludes the request being edited from overlap checks', async () => {
    const emp = await newEmp();
    const other = await newEmp();
    const created = await apply(emp.token, { startDate: day(20), endDate: day(20, 2) });
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;
    const body = { leaveTypeId: types.CL, startDate: day(20), endDate: day(20, 3) };

    // No reason required; the stored request overlaps.
    const plain = await as(emp.token).post('/api/v1/leaves/preview', body);
    expect(plain.status).toBe(200);
    expect(plain.body.data.warnings.map((w: { code: string }) => w.code)).toContain('LEAVE_OVERLAP');

    // Editing that request: no self-overlap, its own pending days are credited back.
    const editing = await as(emp.token).post('/api/v1/leaves/preview', { ...body, excludeId: id });
    expect(editing.status).toBe(200);
    expect(editing.body.data).toMatchObject({ days: 4, balance: 12, balanceAfter: 8, warnings: [] });

    // excludeId must be the caller's own request (same employee / org) and a valid id.
    expect((await as(other.token).post('/api/v1/leaves/preview', { ...body, excludeId: id })).status).toBe(404);
    expect((await as(emp.token).post('/api/v1/leaves/preview', { ...body, excludeId: 'nope' })).status).toBe(400);
  });

  it('unpaid leave types are not limited by balance (still tracked)', async () => {
    const t = await as(admin.token).post('/api/v1/leave-types', { name: 'Unpaid Sabbatical', code: 'USB', paid: false, annualAllowance: 0 });
    expect(t.status).toBe(201);
    const emp = await newEmp();
    const res = await apply(emp.token, { leaveTypeId: t.body.data._id, startDate: day(12), endDate: day(12, 2) });
    expect(res.status).toBe(201);
    await as(mgr.token).post(`/api/v1/leaves/${res.body.data._id}/approve`, {});
    const bal = await balanceOf(emp.token, 'USB');
    expect(bal).toMatchObject({ allocated: 0, used: 3, pending: 0, remaining: -3 });
  });

  it('draft → submit, edit before approval re-reserves correctly, drafts are private', async () => {
    const emp = await newEmp();
    const draft = await apply(emp.token, { startDate: day(14), endDate: day(14, 1), saveAsDraft: true });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('DRAFT');
    const id = draft.body.data._id;
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(0);
    expect((await as(mgr.token).get(`/api/v1/leaves/${id}`)).status).toBe(404);

    const edited = await as(emp.token).patch(`/api/v1/leaves/${id}`, { endDate: day(14, 2) });
    expect(edited.status).toBe(200);
    expect(edited.body.data.days).toBe(3);

    const submitted = await as(emp.token).post(`/api/v1/leaves/${id}/submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(3);
    expect((await as(emp.token).post(`/api/v1/leaves/${id}/submit`)).status).toBe(422);

    // Editing a submitted (untouched) request moves the reservation.
    const shorter = await as(emp.token).patch(`/api/v1/leaves/${id}`, { endDate: day(14) });
    expect(shorter.status).toBe(200);
    expect(shorter.body.data.days).toBe(1);
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(1);
    const toEl = await as(emp.token).patch(`/api/v1/leaves/${id}`, { leaveTypeId: types.EL });
    expect(toEl.status).toBe(200);
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(0);
    expect((await balanceOf(emp.token, 'EL')).pending).toBe(1);

    // Managers cannot edit; approved requests cannot be edited.
    expect((await as(mgr.token).patch(`/api/v1/leaves/${id}`, { reason: 'hack' })).status).toBe(403);
    await as(mgr.token).post(`/api/v1/leaves/${id}/approve`, {});
    const locked = await as(emp.token).patch(`/api/v1/leaves/${id}`, { reason: 'late edit' });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('LEAVE_NOT_EDITABLE');
  });

  it('HR can apply on behalf of an employee; employees cannot', async () => {
    const emp = await newEmp();
    const peer = await newEmp();
    const denied = await apply(peer.token, { employeeId: emp.employee._id, startDate: day(15), endDate: day(15) });
    expect(denied.status).toBe(403);
    const ok = await apply(admin.token, { employeeId: emp.employee._id, startDate: day(15), endDate: day(15) });
    expect(ok.status).toBe(201);
    expect(ok.body.data.employeeId._id).toBe(emp.employee._id);
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(1);
  });

  it('balances endpoint: self, manager and HR allowed; peers forbidden; adjust and carry forward', async () => {
    const emp = await newEmp();
    const peer = await newEmp();
    expect((await as(peer.token).get(`/api/v1/leaves/balances?employeeId=${emp.employee._id}`)).status).toBe(403);
    expect((await as(mgr.token).get(`/api/v1/leaves/balances?employeeId=${emp.employee._id}`)).status).toBe(200);
    const el = await balanceOf(admin.token, 'EL', Y, emp.employee._id);
    expect(el).toMatchObject({ allocated: 15, opening: 0, used: 0, pending: 0, remaining: 15, carryForward: 0, adjusted: 0, encashed: 0 });

    const adj = await as(admin.token).post('/api/v1/leaves/balances/adjust', {
      employeeId: emp.employee._id,
      leaveTypeId: types.CL,
      year: Y,
      adjustment: 2,
      reason: 'Comp off',
    });
    expect(adj.status).toBe(200);
    expect(await balanceOf(emp.token, 'CL')).toMatchObject({ adjusted: 2, remaining: 14 });
    expect((await as(emp.token).post('/api/v1/leaves/balances/adjust', { employeeId: emp.employee._id, leaveTypeId: types.CL, year: Y, adjustment: 5, reason: 'x' })).status).toBe(403);

    // Carry forward last year's unused EL into the current year.
    const prevYear = CURRENT_YEAR - 1;
    await balanceOf(emp.token, 'EL', prevYear);
    const cf = await as(admin.token).post('/api/v1/leaves/balances/carry-forward', { fromYear: prevYear });
    expect(cf.status).toBe(200);
    expect(cf.body.data.processed).toBeGreaterThan(0);
    const cur = await balanceOf(emp.token, 'EL', CURRENT_YEAR);
    expect(cur.carryForward).toBe(15);
    expect(cur.remaining).toBe(cur.allocated + 15);
    const future = await as(admin.token).post('/api/v1/leaves/balances/carry-forward', { fromYear: CURRENT_YEAR });
    expect(future.status).toBe(422);
  });

  it('leave types: CRUD with permission, unique codes, archive blocked while requests pending', async () => {
    const emp = await newEmp();
    expect((await as(emp.token).post('/api/v1/leave-types', { name: 'X', code: 'XX' })).status).toBe(403);
    expect((await as(emp.token).get('/api/v1/leave-types')).status).toBe(200);
    const created = await as(admin.token).post('/api/v1/leave-types', { name: 'Study Leave', code: 'STL', annualAllowance: 5, maxConsecutiveDays: 2 });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect((await as(admin.token).post('/api/v1/leave-types', { name: 'Dup', code: 'stl' })).status).toBe(409);

    // PATCH without defaults: only the given field changes.
    const upd = await as(admin.token).patch(`/api/v1/leave-types/${id}`, { color: '#123456' });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ color: '#123456', annualAllowance: 5, maxConsecutiveDays: 2 });

    const tooLong = await apply(emp.token, { leaveTypeId: id, startDate: day(16), endDate: day(16, 2) });
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('MAX_CONSECUTIVE_DAYS');
    const pending = await apply(emp.token, { leaveTypeId: id, startDate: day(16), endDate: day(16, 1) });
    expect(pending.status).toBe(201);

    const blocked = await as(admin.token).delete(`/api/v1/leave-types/${id}`);
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('LEAVE_TYPE_IN_USE');
    await as(mgr.token).post(`/api/v1/leaves/${pending.body.data._id}/approve`, {});
    expect((await as(admin.token).delete(`/api/v1/leave-types/${id}`)).status).toBe(200);
    const all = await as(emp.token).get('/api/v1/leave-types/all');
    expect(all.body.data.map((t: { _id: string }) => t._id)).not.toContain(id);
  });

  it('calendar shows scoped leave plus holidays; colleagues see minimal fields', async () => {
    const dept = await as(admin.token).post('/api/v1/departments', { name: 'Design', code: 'DSN' });
    expect(dept.status).toBe(201);
    const a = await newEmp({ departmentId: dept.body.data._id });
    const b = await newEmp({ departmentId: dept.body.data._id });
    const { organizationId } = await userIdOf(a.employee._id);
    await HolidayModel.create({ organizationId, name: 'Calendar Holiday', date: dateOnly(day(17, 3)), type: 'PUBLIC' });
    const leave = await apply(a.token, { startDate: day(17), endDate: day(17, 1), reason: 'Private medical reason' });
    await as(mgr.token).post(`/api/v1/leaves/${leave.body.data._id}/approve`, {});

    const range = `from=${day(17)}&to=${day(17, 20)}`;
    const mine = await as(b.token).get(`/api/v1/leaves/calendar?${range}`);
    expect(mine.status).toBe(200);
    const seen = mine.body.data.leaves.find((l: { _id: string }) => l._id === leave.body.data._id);
    expect(seen.restricted).toBe(true);
    expect(seen.reason).toBeUndefined();
    expect(seen.leaveTypeId).toBeUndefined();
    expect(mine.body.data.holidays.map((h: { name: string }) => h.name)).toContain('Calendar Holiday');

    const hr = await as(admin.token).get(`/api/v1/leaves/calendar?${range}&departmentId=${dept.body.data._id}`);
    const full = hr.body.data.leaves.find((l: { _id: string }) => l._id === leave.body.data._id);
    expect(full.reason).toBe('Private medical reason');
    expect(full.restricted).toBe(false);

    const tooWide = await as(admin.token).get(`/api/v1/leaves/calendar?from=${day(1)}&to=${day(20)}`);
    expect(tooWide.status).toBe(400);
  });

  it('list is scoped: employees see only their own, HR sees all', async () => {
    const emp = await newEmp();
    const other = await newEmp();
    await apply(emp.token, { startDate: day(18), endDate: day(18) });
    await apply(other.token, { startDate: day(18), endDate: day(18) });
    const own = await as(emp.token).get('/api/v1/leaves');
    expect(own.status).toBe(200);
    expect(own.body.data.every((l: { employeeId: { _id: string } }) => l.employeeId._id === emp.employee._id)).toBe(true);
    expect((await as(emp.token).get('/api/v1/leaves?scope=all')).status).toBe(403);
    const all = await as(admin.token).get(`/api/v1/leaves?scope=all&employeeId=${other.employee._id}`);
    expect(all.body.data.length).toBe(1);
    expect(all.body.pagination.total).toBe(1);
    // Employees without approval rights get an empty approvals queue.
    const queue = await as(emp.token).get('/api/v1/leaves?scope=approvals');
    expect(queue.body.data).toEqual([]);
  });

  it('enforces tenant isolation', async () => {
    const emp = await newEmp();
    const { body } = await apply(emp.token, { startDate: day(19), endDate: day(19) });
    const other = await registerOrg();
    expect((await as(other.token).get(`/api/v1/leaves/${body.data._id}`)).status).toBe(404);
    expect((await as(other.token).post(`/api/v1/leaves/${body.data._id}/approve`, {})).status).toBe(404);
    expect((await as(other.token).post(`/api/v1/leaves/${body.data._id}/cancel`, {})).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/leaves/balances?employeeId=${emp.employee._id}`)).status).toBe(404);
    const list = await as(other.token).get('/api/v1/leaves?scope=all');
    expect(list.body.data.map((l: { _id: string }) => l._id)).not.toContain(body.data._id);
    // Foreign leave type id is not usable.
    const foreign = await as(other.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(19), endDate: day(19), reason: 'x' });
    expect(foreign.status).toBe(404);
  });
});

describe('Leave management: multi-step approval chain', () => {
  it('MANAGER → HR: first approval is PENDING_APPROVAL, HR finalizes', async () => {
    const admin = await registerOrg();
    const settings = await as(admin.token).patch('/api/v1/organization/settings', { approvals: { leave: ['MANAGER', 'HR'] } });
    expect(settings.status).toBe(200);
    const mgr = await createEmployeeUser(admin.token, { firstName: 'Chain', roles: ['manager'] });
    const emp = await createEmployeeUser(admin.token, { managerId: mgr.employee._id });
    const typesRes = await as(admin.token).get('/api/v1/leave-types/all');
    const cl = (typesRes.body.data as { code: string; _id: string }[]).find((t) => t.code === 'CL')!._id;

    const created = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: cl, startDate: day(20), endDate: day(20, 1), reason: 'Family' });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect(created.body.data.approvalSteps.map((s: { approverType: string }) => s.approverType)).toEqual(['MANAGER', 'HR']);

    const first = await as(mgr.token).post(`/api/v1/leaves/${id}/approve`, {});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ status: 'PENDING_APPROVAL', currentApproverType: 'HR' });
    expect((await balanceOf(emp.token, 'CL')).pending).toBe(2);
    // The employee is told about the manager's approval straight away.
    const step = await NotificationModel.findOne({ userId: (await userIdOf(emp.employee._id)).userId, type: 'LEAVE_APPROVED', entityId: id }).lean();
    expect(step?.message).toMatch(/approved by Chain .* now waiting for approval from HR$/);

    // The HR step: the manager (no leave:read) cannot act; HR (admin) is notified.
    expect((await as(mgr.token).post(`/api/v1/leaves/${id}/approve`, {})).status).toBe(403);
    const adminUser = await UserModel.findOne({ email: admin.email }).select('_id').lean();
    expect(await NotificationModel.exists({ userId: adminUser!._id, type: 'LEAVE_SUBMITTED', entityId: id })).toBeTruthy();

    const final = await as(admin.token).post(`/api/v1/leaves/${id}/approve`, { comment: 'OK' });
    expect(final.status).toBe(200);
    expect(final.body.data.status).toBe('APPROVED');
    expect(await balanceOf(emp.token, 'CL')).toMatchObject({ pending: 0, used: 2 });
  });
});
