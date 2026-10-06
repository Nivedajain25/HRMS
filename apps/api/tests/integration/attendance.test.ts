import { Types } from 'mongoose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AttendanceModel, AuditLogModel, DocumentModel, EmployeeModel } from '../../src/models';
import { autoCloseOpenRecords, autoMarkPreviousDay } from '../../src/services/attendance.service';
import { as, createEmployeeUser, registerOrg } from '../helpers';

/** Calendar key N days before the real current date (UTC org). */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('Attendance, shifts, holidays & regularization', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let manager: Awaited<ReturnType<typeof createEmployeeUser>>;
  let report: Awaited<ReturnType<typeof createEmployeeUser>>;
  let outsider: Awaited<ReturnType<typeof createEmployeeUser>>;
  let hr: Awaited<ReturnType<typeof createEmployeeUser>>;

  beforeAll(async () => {
    admin = await registerOrg();
    manager = await createEmployeeUser(admin.token, { firstName: 'Mona', roles: ['manager'] });
    report = await createEmployeeUser(admin.token, { firstName: 'Ravi', managerId: manager.employee._id });
    outsider = await createEmployeeUser(admin.token, { firstName: 'Otto' });
    hr = await createEmployeeUser(admin.token, { firstName: 'Hana', roles: ['hr_manager'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('clock-in / breaks / clock-out', () => {
    it('runs the full day flow and computes hours', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const e = as(report.token);

      vi.setSystemTime(new Date('2026-03-10T09:05:00.000Z'));
      const before = await e.get('/api/v1/attendance/today');
      expect(before.status).toBe(200);
      expect(before.body.data.state).toBe('NOT_CHECKED_IN');
      expect(before.body.data.shift.code).toBe('GEN');

      const inRes = await e.post('/api/v1/attendance/check-in', { workMode: 'OFFICE' });
      expect(inRes.status).toBe(200);
      expect(inRes.body.data.state).toBe('CHECKED_IN');
      expect(inRes.body.data.date).toBe('2026-03-10');
      expect(inRes.body.data.record.isLate).toBe(false);

      // Double check-in is rejected.
      const again = await e.post('/api/v1/attendance/check-in', { workMode: 'OFFICE' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_CHECKED_IN');

      // Cannot end a break that was never started.
      expect((await e.post('/api/v1/attendance/break/end')).status).toBe(400);

      vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
      const bs = await e.post('/api/v1/attendance/break/start');
      expect(bs.status).toBe(200);
      expect(bs.body.data.state).toBe('ON_BREAK');
      expect((await e.post('/api/v1/attendance/break/start')).status).toBe(409);

      vi.setSystemTime(new Date('2026-03-10T12:30:00.000Z'));
      expect((await e.post('/api/v1/attendance/break/end')).status).toBe(200);

      vi.setSystemTime(new Date('2026-03-10T18:10:00.000Z'));
      const out = await e.post('/api/v1/attendance/check-out', { note: 'Done' });
      expect(out.status).toBe(200);
      const rec = out.body.data.record;
      expect(out.body.data.state).toBe('CHECKED_OUT');
      expect(rec.breakMinutes).toBe(30);
      expect(rec.workingMinutes).toBe(9 * 60 + 5 - 30);
      expect(rec.overtimeMinutes).toBe(0);
      expect(rec.status).toBe('PRESENT');

      // Checking out twice / starting a break after check-out is rejected.
      expect((await e.post('/api/v1/attendance/check-out')).status).toBe(409);
      expect((await e.post('/api/v1/attendance/break/start')).status).toBe(409);
    });

    it('rejects check-out without check-in and marks late arrivals', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-11T09:45:00.000Z'));
      const e = as(outsider.token);
      const noIn = await e.post('/api/v1/attendance/check-out');
      expect(noIn.status).toBe(400);
      expect(noIn.body.code).toBe('NOT_CHECKED_IN');
      const late = await e.post('/api/v1/attendance/check-in', { workMode: 'OFFICE' });
      expect(late.status).toBe(200);
      expect(late.body.data.record.isLate).toBe(true);
      expect(late.body.data.record.lateMinutes).toBe(30);
      expect(late.body.data.record.status).toBe('LATE');
    });

    it('supports remote clock-in as work from home', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-03-11T08:55:00.000Z'));
      const res = await as(manager.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE' });
      expect(res.status).toBe(200);
      expect(res.body.data.record.status).toBe('WORK_FROM_HOME');
    });
  });

  describe('visibility & admin', () => {
    it('protects records from other employees (IDOR) and scopes managers to their team', async () => {
      const own = await as(report.token).get('/api/v1/attendance');
      expect(own.status).toBe(200);
      expect(own.body.data.length).toBeGreaterThan(0);
      expect(own.body.data.every((r: { employeeId: { _id: string } }) => r.employeeId._id === report.employee._id)).toBe(true);

      const outsiderRecord = await AttendanceModel.findOne({ employeeId: outsider.employee._id }).lean();
      expect((await as(report.token).get(`/api/v1/attendance/${String(outsiderRecord!._id)}`)).status).toBe(403);
      expect((await as(report.token).get(`/api/v1/attendance?employeeId=${outsider.employee._id}`)).status).toBe(403);
      expect((await as(report.token).get('/api/v1/attendance?scope=all')).status).toBe(403);

      const team = await as(manager.token).get('/api/v1/attendance?limit=100');
      const ids = team.body.data.map((r: { employeeId: { _id: string } }) => r.employeeId._id);
      expect(ids).toContain(report.employee._id);
      expect(ids).not.toContain(outsider.employee._id);
      const reportRecord = await AttendanceModel.findOne({ employeeId: report.employee._id }).lean();
      expect((await as(manager.token).get(`/api/v1/attendance/${String(reportRecord!._id)}`)).status).toBe(200);
      expect((await as(manager.token).get(`/api/v1/attendance/${String(outsiderRecord!._id)}`)).status).toBe(403);

      // Dashboard: team for managers, forbidden for plain employees.
      const dash = await as(manager.token).get('/api/v1/attendance/dashboard?date=2026-03-11');
      expect(dash.status).toBe(200);
      expect(dash.body.data.scope).toBe('team');
      expect((await as(report.token).get('/api/v1/attendance/dashboard')).status).toBe(403);
    });

    it('provides org dashboard and monthly summary', async () => {
      const dash = await as(admin.token).get('/api/v1/attendance/dashboard?date=2026-03-11');
      expect(dash.status).toBe(200);
      const d = dash.body.data;
      expect(d.presentToday).toBe(2);
      expect(d.lateToday).toBe(1);
      expect(d.workFromHome).toBe(1);
      expect(d.trend).toHaveLength(14);
      expect(d.monthly).toHaveLength(6);
      expect(Array.isArray(d.byDepartment)).toBe(true);

      const sum = await as(report.token).get('/api/v1/attendance/summary?from=2026-03-01&to=2026-03-31');
      expect(sum.status).toBe(200);
      expect(sum.body.data.employees).toHaveLength(1);
      const s = sum.body.data.employees[0];
      expect(s.present).toBe(1);
      expect(s.totalWorkingHours).toBeCloseTo(515 / 60, 2);
      expect((await as(report.token).get(`/api/v1/attendance/summary?employeeId=${outsider.employee._id}`)).status).toBe(403);
    });

    it('lets admins create and edit records with recomputation and audit', async () => {
      const created = await as(admin.token).post('/api/v1/attendance', {
        employeeId: outsider.employee._id,
        date: '2026-03-02',
        checkIn: '09:00',
        checkOut: '12:30',
      });
      expect(created.status).toBe(201);
      expect(created.body.data.status).toBe('HALF_DAY');
      expect(created.body.data.source).toBe('ADMIN');
      const id = created.body.data._id;

      const dup = await as(admin.token).post('/api/v1/attendance', { employeeId: outsider.employee._id, date: '2026-03-02', status: 'ABSENT' });
      expect(dup.status).toBe(409);

      // Employees cannot edit attendance.
      expect((await as(outsider.token).patch(`/api/v1/attendance/${id}`, { status: 'PRESENT' })).status).toBe(403);

      const upd = await as(admin.token).patch(`/api/v1/attendance/${id}`, { checkOut: '2026-03-02T19:00:00.000Z' });
      expect(upd.status).toBe(200);
      expect(upd.body.data.workingMinutes).toBe(600);
      expect(upd.body.data.overtimeMinutes).toBe(60);
      expect(upd.body.data.status).toBe('PRESENT');

      const log = await AuditLogModel.findOne({ action: 'ATTENDANCE_UPDATED', recordId: new Types.ObjectId(id) }).sort({ timestamp: -1 }).lean();
      expect(log).toBeTruthy();
      expect((log!.newValues as Record<string, unknown>).workingMinutes).toBe(600);
      expect((log!.oldValues as Record<string, unknown>).workingMinutes).toBe(210);

      const bad = await as(admin.token).patch(`/api/v1/attendance/${id}`, { checkOut: '2026-03-02T08:00:00.000Z' });
      expect(bad.status).toBe(400);
    });
  });

  describe('shifts', () => {
    let nightId: string;

    it('creates, updates and guards shifts', async () => {
      expect((await as(report.token).post('/api/v1/shifts', { name: 'X', code: 'X', startTime: '09:00', endTime: '17:00' })).status).toBe(403);
      const night = await as(admin.token).post('/api/v1/shifts', { name: 'Night', code: 'NGT', startTime: '22:00', endTime: '06:00', workingHours: 7 });
      expect(night.status).toBe(201);
      expect(night.body.data.nightShift).toBe(true);
      nightId = night.body.data._id;
      expect((await as(admin.token).post('/api/v1/shifts', { name: 'Night 2', code: 'NGT', startTime: '22:00', endTime: '06:00' })).status).toBe(409);

      const upd = await as(admin.token).patch(`/api/v1/shifts/${nightId}`, { gracePeriodMinutes: 5 });
      expect(upd.status).toBe(200);
      // Partial update does not reset other fields to defaults.
      expect(upd.body.data.workingHours).toBe(7);
      expect(upd.body.data.gracePeriodMinutes).toBe(5);

      // Only one default shift.
      const flex = await as(admin.token).post('/api/v1/shifts', { name: 'Flexi', code: 'FLX', startTime: '10:00', endTime: '19:00', flexible: true, isDefault: true });
      expect(flex.status).toBe(201);
      const all = await as(report.token).get('/api/v1/shifts/all');
      expect(all.status).toBe(200);
      expect(all.body.data.filter((s: { isDefault: boolean }) => s.isDefault)).toHaveLength(1);
      expect((await as(admin.token).delete(`/api/v1/shifts/${flex.body.data._id}`)).status).toBe(422);
    });

    it('assigns shifts with history, schedule and deletion guard', async () => {
      const res = await as(admin.token).post('/api/v1/shifts/assign', {
        shiftId: nightId,
        employeeIds: [outsider.employee._id],
        effectiveFrom: '2024-06-01',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.assigned).toBe(1);
      expect(res.body.data.appliedToProfile).toBe(true);

      const emp = await EmployeeModel.findById(outsider.employee._id).lean();
      expect(String(emp!.shiftId)).toBe(nightId);

      const hist = await as(admin.token).get(`/api/v1/employees/${outsider.employee._id}/history`);
      const shiftEntry = hist.body.data.find((h: { field: string }) => h.field === 'shift');
      expect(shiftEntry.newLabel).toBe('Night');
      expect(shiftEntry.oldLabel).toBe('General Shift');

      const asg = await as(outsider.token).get(`/api/v1/shifts/assignments?employeeId=${outsider.employee._id}`);
      expect(asg.status).toBe(200);
      expect(asg.body.data[0].shiftId.code).toBe('NGT');
      expect(asg.body.data[0].effectiveTo).toBeNull();
      // Previous assignment was closed at the new effective date.
      expect(asg.body.data[1].effectiveTo.slice(0, 10)).toBe('2024-06-01');
      expect((await as(report.token).get(`/api/v1/shifts/assignments?employeeId=${outsider.employee._id}`)).status).toBe(403);

      const sched = await as(admin.token).get('/api/v1/shifts/schedule?from=2026-03-01&to=2026-03-07');
      expect(sched.status).toBe(200);
      expect(sched.body.data.dates).toHaveLength(7);
      const row = sched.body.data.employees.find((r: { employee: { _id: string } }) => r.employee._id === outsider.employee._id);
      expect(row.days[0].shift.code).toBe('NGT');
      expect((await as(admin.token).get('/api/v1/shifts/schedule?from=2026-03-01&to=2026-04-15')).status).toBe(400);

      expect((await as(admin.token).delete(`/api/v1/shifts/${nightId}`)).status).toBe(422);
    });
  });

  describe('holidays', () => {
    it('supports CRUD, duplicates, locations and recurring expansion', async () => {
      expect((await as(report.token).post('/api/v1/holidays', { name: 'X', date: '2026-01-01' })).status).toBe(403);
      const ny = await as(admin.token).post('/api/v1/holidays', { name: 'New Year', date: '2020-01-01', recurring: true });
      expect(ny.status).toBe(201);
      expect((await as(admin.token).post('/api/v1/holidays', { name: 'new year', date: '2020-01-01' })).status).toBe(409);

      const loc = await as(admin.token).post('/api/v1/locations', { name: 'Pune Office', type: 'OFFICE' });
      expect(loc.status).toBe(201);
      const regional = await as(admin.token).post('/api/v1/holidays', { name: 'Gudi Padwa', date: '2027-03-19', type: 'REGIONAL', locationIds: [loc.body.data._id] });
      expect(regional.status).toBe(201);

      const list2027 = await as(report.token).get('/api/v1/holidays?year=2027');
      expect(list2027.status).toBe(200);
      const dates = list2027.body.data.map((h: { date: string }) => h.date);
      expect(dates).toContain('2027-01-01');
      expect(dates).toContain('2027-03-19');
      expect([...dates].sort()).toEqual(dates);

      const otherLoc = await as(admin.token).post('/api/v1/locations', { name: 'Delhi Office', type: 'OFFICE' });
      const delhi = await as(report.token).get(`/api/v1/holidays?year=2027&locationId=${otherLoc.body.data._id}`);
      expect(delhi.body.data.map((h: { date: string }) => h.date)).not.toContain('2027-03-19');

      const upd = await as(admin.token).patch(`/api/v1/holidays/${regional.body.data._id}`, { description: 'Marathi new year' });
      expect(upd.status).toBe(200);
      expect(upd.body.data.type).toBe('REGIONAL');
      expect(upd.body.data.recurring).toBe(false);

      const upcoming = await as(report.token).get('/api/v1/holidays/upcoming?limit=3');
      expect(upcoming.status).toBe(200);
      expect(upcoming.body.data[0].name).toBe('New Year');

      expect((await as(admin.token).delete(`/api/v1/holidays/${regional.body.data._id}`)).status).toBe(200);
      expect((await as(admin.token).get(`/api/v1/holidays/${regional.body.data._id}`)).status).toBe(404);
    });
  });

  describe('regularization', () => {
    const date = daysAgo(3);

    it('runs the MANAGER → HR chain and updates attendance', async () => {
      const sub = await as(report.token).post('/api/v1/attendance/regularizations', {
        date,
        requestedCheckIn: '09:00',
        requestedCheckOut: '17:30',
        reason: 'Forgot to clock in',
      });
      expect(sub.status).toBe(201);
      const id = sub.body.data._id;
      expect(sub.body.data.status).toBe('SUBMITTED');
      expect(sub.body.data.currentApproverType).toBe('MANAGER');

      const dup = await as(report.token).post('/api/v1/attendance/regularizations', { date, requestedCheckIn: '09:00', requestedCheckOut: '17:00', reason: 'x' });
      expect(dup.status).toBe(409);

      // Manager sees it in their approval queue; outsider cannot read it.
      const queue = await as(manager.token).get('/api/v1/attendance/regularizations?scope=approvals');
      expect(queue.body.data.map((r: { _id: string }) => r._id)).toContain(id);
      expect((await as(outsider.token).get(`/api/v1/attendance/regularizations/${id}`)).status).toBe(403);
      // The employee cannot approve.
      expect((await as(report.token).post(`/api/v1/attendance/regularizations/${id}/approve`, {})).status).toBe(403);

      const m = await as(manager.token).post(`/api/v1/attendance/regularizations/${id}/approve`, { comment: 'OK' });
      expect(m.status).toBe(200);
      expect(m.body.data.status).toBe('PENDING_APPROVAL');
      expect(m.body.data.currentApproverType).toBe('HR');
      // Manager cannot act on the HR step.
      expect((await as(manager.token).post(`/api/v1/attendance/regularizations/${id}/approve`, {})).status).toBe(403);

      const hrQueue = await as(hr.token).get('/api/v1/attendance/regularizations?scope=approvals');
      expect(hrQueue.body.data.map((r: { _id: string }) => r._id)).toContain(id);

      const h = await as(hr.token).post(`/api/v1/attendance/regularizations/${id}/approve`, {});
      expect(h.status).toBe(200);
      expect(h.body.data.status).toBe('APPROVED');
      expect(h.body.data.approvalSteps.map((s: { status: string }) => s.status)).toEqual(['APPROVED', 'APPROVED']);

      const att = await AttendanceModel.findOne({ employeeId: report.employee._id, date: new Date(`${date}T00:00:00.000Z`) }).lean();
      expect(att?.regularized).toBe(true);
      expect(att?.source).toBe('REGULARIZATION');
      expect(att?.checkIn?.toISOString()).toBe(`${date}T09:00:00.000Z`);
      expect(att?.checkOut?.toISOString()).toBe(`${date}T17:30:00.000Z`);
      expect(att?.workingMinutes).toBe(510);
      expect(await AuditLogModel.exists({ action: 'ATTENDANCE_REGULARIZED', recordId: att!._id })).toBeTruthy();

      // Terminal: cannot approve again.
      expect((await as(hr.token).post(`/api/v1/attendance/regularizations/${id}/approve`, {})).status).toBe(422);
    });

    it('supports rejection and cancellation', async () => {
      const r1 = await as(report.token).post('/api/v1/attendance/regularizations', { date: daysAgo(4), requestedCheckIn: '10:00', requestedCheckOut: '18:00', reason: 'Traffic' });
      expect(r1.status).toBe(201);
      expect((await as(manager.token).post(`/api/v1/attendance/regularizations/${r1.body.data._id}/reject`, {})).status).toBe(400);
      const rej = await as(manager.token).post(`/api/v1/attendance/regularizations/${r1.body.data._id}/reject`, { reason: 'Not verified' });
      expect(rej.status).toBe(200);
      expect(rej.body.data.status).toBe('REJECTED');
      expect(rej.body.data.rejectionReason).toBe('Not verified');
      expect((await as(manager.token).post(`/api/v1/attendance/regularizations/${r1.body.data._id}/approve`, {})).status).toBe(422);

      const r2 = await as(report.token).post('/api/v1/attendance/regularizations', { date: daysAgo(5), requestedCheckIn: '09:00', requestedCheckOut: '18:00', reason: 'Badge failure' });
      expect((await as(manager.token).post(`/api/v1/attendance/regularizations/${r2.body.data._id}/cancel`)).status).toBe(403);
      const c = await as(report.token).post(`/api/v1/attendance/regularizations/${r2.body.data._id}/cancel`);
      expect(c.status).toBe(200);
      expect(c.body.data.status).toBe('CANCELLED');

      const mine = await as(report.token).get('/api/v1/attendance/regularizations?scope=me');
      expect(mine.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('blocks self-approval and future dates', async () => {
      const own = await as(hr.token).post('/api/v1/attendance/regularizations', { date: daysAgo(2), requestedCheckIn: '09:00', requestedCheckOut: '18:00', reason: 'Own request' });
      expect(own.status).toBe(201);
      expect((await as(hr.token).post(`/api/v1/attendance/regularizations/${own.body.data._id}/approve`, {})).status).toBe(403);

      const future = await as(report.token).post('/api/v1/attendance/regularizations', { date: daysAgo(-3), requestedCheckIn: '09:00', requestedCheckOut: '18:00', reason: 'Future' });
      expect(future.status).toBe(400);
    });
  });

  describe('scheduled job', () => {
    it('auto-closes open records and marks the previous day idempotently', async () => {
      const orgId = new Types.ObjectId(String(admin.user.organization._id));
      const open = await as(admin.token).post('/api/v1/attendance', { employeeId: report.employee._id, date: '2026-02-02', checkIn: '09:00' });
      expect(open.status).toBe(201);
      expect(await autoCloseOpenRecords(orgId)).toBeGreaterThanOrEqual(1);
      const closed = await AttendanceModel.findById(open.body.data._id).lean();
      expect(closed?.checkOut?.toISOString()).toBe('2026-02-02T18:00:00.000Z');
      expect(closed?.note).toContain('Auto clock-out');
      expect(closed?.workingMinutes).toBe(540);

      const first = await autoMarkPreviousDay(orgId);
      expect(first).toBeGreaterThan(0);
      expect(await autoMarkPreviousDay(orgId)).toBe(0);
      const y = daysAgo(1);
      const marked = await AttendanceModel.findOne({ organizationId: orgId, employeeId: outsider.employee._id, date: new Date(`${y}T00:00:00.000Z`) }).lean();
      expect(['ABSENT', 'WEEK_OFF', 'HOLIDAY', 'LEAVE']).toContain(marked?.status);
      expect(marked?.source).toBe('SYSTEM');
    });
  });

  describe('tenant isolation', () => {
    it('never exposes another organization’s records', async () => {
      const other = await registerOrg();
      const rec = await AttendanceModel.findOne({ employeeId: report.employee._id }).lean();
      const reg = await as(report.token).get('/api/v1/attendance/regularizations?scope=me');
      const shifts = await as(admin.token).get('/api/v1/shifts/all');
      const holidays = await as(admin.token).get('/api/v1/holidays?year=2027');
      const o = as(other.token);
      expect((await o.get(`/api/v1/attendance/${String(rec!._id)}`)).status).toBe(404);
      expect((await o.patch(`/api/v1/attendance/${String(rec!._id)}`, { status: 'ABSENT' })).status).toBe(404);
      expect((await o.get(`/api/v1/attendance/regularizations/${reg.body.data[0]._id}`)).status).toBe(404);
      expect((await o.post(`/api/v1/attendance/regularizations/${reg.body.data[0]._id}/approve`, {})).status).toBe(404);
      expect((await o.get(`/api/v1/shifts/${shifts.body.data[0]._id}`)).status).toBe(404);
      expect((await o.get(`/api/v1/holidays/${holidays.body.data[0]._id}`)).status).toBe(404);
      const list = await o.get('/api/v1/attendance?limit=100');
      expect(list.body.data).toHaveLength(0);
      // Cannot record attendance for a foreign employee or assign a foreign shift.
      expect((await o.post('/api/v1/attendance', { employeeId: report.employee._id, date: '2026-03-03', status: 'ABSENT' })).status).toBe(400);
      expect((await o.post('/api/v1/shifts/assign', { shiftId: shifts.body.data[0]._id, employeeIds: [report.employee._id], effectiveFrom: '2026-01-01' })).status).toBe(404);
      // Foreign location on a holiday is rejected.
      const loc = await as(admin.token).get('/api/v1/locations/all');
      expect((await o.post('/api/v1/holidays', { name: 'Sneaky', date: '2026-05-01', locationIds: [loc.body.data[0]._id] })).status).toBe(400);
    });
  });
});

/** Smallest valid 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Attendance selfie & GPS capture', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let manager: Awaited<ReturnType<typeof createEmployeeUser>>;
  let emp: Awaited<ReturnType<typeof createEmployeeUser>>;
  let peer: Awaited<ReturnType<typeof createEmployeeUser>>;
  let hr: Awaited<ReturnType<typeof createEmployeeUser>>;

  const setCapture = (requireSelfie: boolean, requireLocation: boolean) =>
    as(admin.token).patch('/api/v1/organization/settings', { attendance: { requireSelfie, requireLocation } });
  const uploadSelfie = async (token: string) => {
    const res = await as(token).upload('/api/v1/files').field('context', 'ATTENDANCE').attach('file', PNG, 'selfie.png');
    expect(res.status).toBe(201);
    return res.body.data._id as string;
  };
  const coords = { latitude: 12.9716, longitude: 77.5946, accuracy: 18 };

  beforeAll(async () => {
    admin = await registerOrg();
    manager = await createEmployeeUser(admin.token, { firstName: 'Mira', roles: ['manager'] });
    emp = await createEmployeeUser(admin.token, { firstName: 'Sam', managerId: manager.employee._id });
    peer = await createEmployeeUser(admin.token, { firstName: 'Pia' });
    hr = await createEmployeeUser(admin.token, { firstName: 'Hugo', roles: ['hr_manager'] });
  });

  it('exposes the capture settings on /today', async () => {
    expect((await setCapture(true, false)).status).toBe(200);
    const today = await as(emp.token).get('/api/v1/attendance/today');
    expect(today.status).toBe(200);
    expect(today.body.data.requireSelfie).toBe(true);
    expect(today.body.data.requireLocation).toBe(false);
    expect(typeof today.body.data.allowRemoteClockIn).toBe('boolean');
  });

  it('requires a fresh, unused selfie and records photo + location', async () => {
    expect((await setCapture(true, false)).status).toBe(200);
    const e = as(emp.token);

    const missing = await e.post('/api/v1/attendance/check-in', { workMode: 'REMOTE', ...coords });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('SELFIE_REQUIRED');

    // Only images are accepted for the ATTENDANCE context.
    const pdf = await e.upload('/api/v1/files').field('context', 'ATTENDANCE').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'x.pdf');
    expect(pdf.status).toBe(400);

    const photoId = await uploadSelfie(emp.token);

    // A photo uploaded by someone else cannot be used.
    const foreign = await as(peer.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE', photoId });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('INVALID_SELFIE');

    const inRes = await e.post('/api/v1/attendance/check-in', { workMode: 'REMOTE', photoId, ...coords });
    expect(inRes.status).toBe(200);
    const rec = inRes.body.data.record;
    expect(String(rec.checkInPhotoId)).toBe(photoId);
    expect(rec.checkInLocation).toMatchObject(coords);

    // The same photo cannot be reused for clock-out.
    const reuse = await e.post('/api/v1/attendance/check-out', { photoId, ...coords });
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('INVALID_SELFIE');

    // A stale photo (older than 10 minutes) is rejected.
    const stale = await uploadSelfie(emp.token);
    await DocumentModel.collection.updateOne({ _id: new Types.ObjectId(stale) }, { $set: { createdAt: new Date(Date.now() - 11 * 60_000) } });
    const old = await e.post('/api/v1/attendance/check-out', { photoId: stale });
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('INVALID_SELFIE');

    const outPhoto = await uploadSelfie(emp.token);
    const out = await e.post('/api/v1/attendance/check-out', { photoId: outPhoto, latitude: 12.97, longitude: 77.59, accuracy: 40 });
    expect(out.status).toBe(200);
    expect(String(out.body.data.record.checkOutPhotoId)).toBe(outPhoto);
    expect(out.body.data.record.checkOutLocation).toMatchObject({ latitude: 12.97, longitude: 77.59, accuracy: 40 });

    // The selfie is only required at clock-in: clocking out without one works.
    const solo = await createEmployeeUser(admin.token, { firstName: 'Sol' });
    const soloIn = await as(solo.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE', photoId: await uploadSelfie(solo.token) });
    expect(soloIn.status).toBe(200);
    const soloOut = await as(solo.token).post('/api/v1/attendance/check-out', {});
    expect(soloOut.status).toBe(200);
    expect(soloOut.body.data.record.checkOutPhotoId).toBeNull();

    // Exposed on the record endpoints.
    const got = await as(hr.token).get(`/api/v1/attendance/${rec._id}`);
    expect(got.status).toBe(200);
    expect(String(got.body.data.checkInPhotoId)).toBe(photoId);
    expect(String(got.body.data.checkOutPhotoId)).toBe(outPhoto);
    const list = await as(manager.token).get(`/api/v1/attendance?employeeId=${emp.employee._id}`);
    expect(String(list.body.data[0].checkInPhotoId)).toBe(photoId);

    // Selfie visibility: owner, manager chain and HR only.
    expect((await e.get(`/api/v1/files/${photoId}`)).status).toBe(200);
    expect((await as(manager.token).get(`/api/v1/files/${photoId}`)).status).toBe(200);
    expect((await as(hr.token).get(`/api/v1/files/${photoId}`)).status).toBe(200);
    expect([403, 404]).toContain((await as(peer.token).get(`/api/v1/files/${photoId}`)).status);
  });

  it('requires coordinates when location is mandatory', async () => {
    expect((await setCapture(false, true)).status).toBe(200);
    const p = as(peer.token);
    const res = await p.post('/api/v1/attendance/check-in', { workMode: 'REMOTE' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LOCATION_REQUIRED');
    const ok = await p.post('/api/v1/attendance/check-in', { workMode: 'REMOTE', ...coords });
    expect(ok.status).toBe(200);
    expect(ok.body.data.record.checkInLocation).toMatchObject(coords);
    // Location is only mandatory at clock-in: clocking out without it is recorded without a location.
    const noLoc = await p.post('/api/v1/attendance/check-out', {});
    expect(noLoc.status).toBe(200);
    expect(noLoc.body.data.record.checkOutLocation ?? null).toBeNull();
  });

  it('stays backward compatible when both settings are off', async () => {
    expect((await setCapture(false, false)).status).toBe(200);
    const m = as(manager.token);
    const inRes = await m.post('/api/v1/attendance/check-in', { workMode: 'REMOTE' });
    expect(inRes.status).toBe(200);
    expect(inRes.body.data.record.checkInPhotoId ?? null).toBeNull();
    expect((await m.post('/api/v1/attendance/check-out')).status).toBe(200);
  });
});

describe('Office proximity at clock in/out', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let atDesk: Awaited<ReturnType<typeof createEmployeeUser>>;
  let away: Awaited<ReturnType<typeof createEmployeeUser>>;
  let noOffice: Awaited<ReturnType<typeof createEmployeeUser>>;
  let silent: Awaited<ReturnType<typeof createEmployeeUser>>;
  const OFFICE = { latitude: 12.9716, longitude: 77.5946 };

  beforeAll(async () => {
    admin = await registerOrg();
    expect((await as(admin.token).patch('/api/v1/organization/settings', { attendance: { requireSelfie: false, requireLocation: false } })).status).toBe(200);
    const loc = await as(admin.token).post('/api/v1/locations', { name: 'Head Office', ...OFFICE, geofenceRadiusMeters: 150 });
    expect(loc.status).toBe(201);
    const locationId = loc.body.data._id as string;
    atDesk = await createEmployeeUser(admin.token, { firstName: 'Ina', locationId });
    away = await createEmployeeUser(admin.token, { firstName: 'Otto', locationId });
    noOffice = await createEmployeeUser(admin.token, { firstName: 'Nora' });
    silent = await createEmployeeUser(admin.token, { firstName: 'Sid', locationId });
  });

  it('records the office distance and flags clock-ins outside the office instead of blocking them', async () => {
    const inside = await as(atDesk.token).post('/api/v1/attendance/check-in', { workMode: 'OFFICE', latitude: 12.9717, longitude: 77.5947, accuracy: 10 });
    expect(inside.status).toBe(200);
    expect(inside.body.data.record.checkInLocation).toMatchObject({ officeName: 'Head Office', withinOffice: true });
    expect(inside.body.data.record.checkInLocation.distanceMeters).toBeLessThan(30);

    // ~2.2 km north of the office: allowed (not blocked) but flagged.
    const outside = await as(away.token).post('/api/v1/attendance/check-in', { workMode: 'OFFICE', latitude: 12.9916, longitude: 77.5946, accuracy: 15 });
    expect(outside.status).toBe(200);
    expect(outside.body.data.record.checkInLocation).toMatchObject({ officeName: 'Head Office', withinOffice: false });
    expect(outside.body.data.record.checkInLocation.distanceMeters).toBeGreaterThan(2000);

    // GPS accuracy is credited (up to 100 m): 190 m away with ±60 m counts as inside a 150 m office area.
    const out = await as(away.token).post('/api/v1/attendance/check-out', { latitude: 12.97331, longitude: 77.5946, accuracy: 60 });
    expect(out.status).toBe(200);
    expect(out.body.data.record.checkOutLocation.withinOffice).toBe(true);

    // No office assigned: coordinates only, no proximity.
    const remote = await as(noOffice.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE', latitude: 13, longitude: 77.6 });
    expect(remote.status).toBe(200);
    expect(remote.body.data.record.checkInLocation.latitude).toBe(13);
    expect(remote.body.data.record.checkInLocation.withinOffice).toBeUndefined();
    expect(remote.body.data.record.checkInLocation.distanceMeters).toBeUndefined();

    // No GPS shared at all.
    expect((await as(silent.token).post('/api/v1/attendance/check-in', { workMode: 'OFFICE' })).status).toBe(200);

    // HR sees it on the record list.
    const list = await as(admin.token).get(`/api/v1/attendance?employeeId=${away.employee._id}`);
    expect(list.body.data[0].checkInLocation).toMatchObject({ withinOffice: false, officeName: 'Head Office' });
  });

  it('adds office location to the attendance summary and the attendance log reports', async () => {
    const from = daysAgo(1);
    const to = daysAgo(-1);
    const summary = await as(admin.token).get(`/api/v1/reports/attendance?from=${from}&to=${to}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.columns.map((c: { key: string }) => c.key)).toEqual(expect.arrayContaining(['atOffice', 'outsideOffice', 'noLocation']));
    const row = (name: string) => summary.body.data.rows.find((r: { name: string }) => r.name === name);
    expect(row('Ina Person')).toMatchObject({ atOffice: 1, outsideOffice: 0, noLocation: 0 });
    // Otto clocked in outside but clocked out inside the office area; nobody else has clocked out.
    expect(row('Otto Person')).toMatchObject({ atOffice: 0, outsideOffice: 1, noLocation: 0, outAtOffice: 1, outOutsideOffice: 0, outNoLocation: 0 });
    expect(row('Sid Person')).toMatchObject({ atOffice: 0, outsideOffice: 0, noLocation: 1, outAtOffice: 0, outNoLocation: 0 });
    expect(summary.body.data.summary.totals).toMatchObject({ atOffice: 1, outsideOffice: 1, noLocation: 1, outAtOffice: 1, outOutsideOffice: 0, outNoLocation: 0 });

    const log = await as(admin.token).get(`/api/v1/reports/attendance_log?from=${from}&to=${to}`);
    expect(log.status).toBe(200);
    const otto = log.body.data.rows.find((r: { name: string }) => r.name === 'Otto Person');
    expect(otto).toMatchObject({ checkInPlace: 'Outside office', checkInOffice: 'Head Office', checkOutPlace: 'At office' });
    expect(otto.checkInDistance).toBeGreaterThan(2000);
    expect(otto.checkInMap).toBe('https://www.google.com/maps?q=12.9916,77.5946');
    const nora = log.body.data.rows.find((r: { name: string }) => r.name === 'Nora Person');
    expect(nora.checkInPlace).toBe('No office coordinates');
    const sid = log.body.data.rows.find((r: { name: string }) => r.name === 'Sid Person');
    expect(sid).toMatchObject({ checkInPlace: 'No location', checkInCoordinates: null });
    expect(log.body.data.summary.byClockInPlace).toMatchObject({ 'At office': 1, 'Outside office': 1, 'No location': 1 });

    // The log needs attendance access on top of report access; employees get neither.
    expect((await as(atDesk.token).get('/api/v1/reports/attendance_log')).status).toBe(403);
    const csv = await as(admin.token).get(`/api/v1/reports/attendance_log?from=${from}&to=${to}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Outside office');
  });
});

describe('Live attendance board (kanban)', () => {
  it('puts every employee in exactly one column and scopes managers to their team', async () => {
    const admin = await registerOrg();
    expect((await as(admin.token).patch('/api/v1/organization/settings', { attendance: { requireSelfie: false, requireLocation: false } })).status).toBe(200);
    const boss = await createEmployeeUser(admin.token, { firstName: 'Boss', roles: ['manager'] });
    const working = await createEmployeeUser(admin.token, { firstName: 'Wes', managerId: boss.employee._id });
    const onBreak = await createEmployeeUser(admin.token, { firstName: 'Bree' });
    const done = await createEmployeeUser(admin.token, { firstName: 'Dan' });
    const away = await createEmployeeUser(admin.token, { firstName: 'Ava' });
    const idle = await createEmployeeUser(admin.token, { firstName: 'Ian' });

    expect((await as(working.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE' })).status).toBe(200);
    expect((await as(onBreak.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE' })).status).toBe(200);
    expect((await as(onBreak.token).post('/api/v1/attendance/break/start')).status).toBe(200);
    expect((await as(done.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE' })).status).toBe(200);
    expect((await as(done.token).post('/api/v1/attendance/check-out')).status).toBe(200);

    const board0 = await as(admin.token).get('/api/v1/attendance/board');
    const today = board0.body.data.date as string;
    expect((await as(admin.token).post('/api/v1/attendance', { employeeId: away.employee._id, date: today, status: 'LEAVE' })).status).toBe(201);

    const res = await as(admin.token).get('/api/v1/attendance/board');
    expect(res.status).toBe(200);
    const board = res.body.data;
    const columnOf = (e: { employee: { _id: string } }) => board.cards.find((c: { employee: { _id: string } }) => c.employee._id === e.employee._id)?.column;
    expect(columnOf(working)).toBe('WORKING');
    expect(columnOf(onBreak)).toBe('ON_BREAK');
    expect(columnOf(done)).toBe('DONE');
    expect(columnOf(away)).toBe('AWAY');
    // Nobody-yet: expected to clock in on a working day, "off" on a weekend/holiday.
    expect(columnOf(idle)).toBe(board.dayKind === 'WORKING' ? 'NOT_IN' : 'AWAY');
    // Every card in one column; counts add up.
    const counts = Object.fromEntries(board.columns.map((c: { key: string; count: number }) => [c.key, c.count]));
    expect(Object.values(counts).reduce((a, b) => (a as number) + (b as number), 0)).toBe(board.cards.length);
    const wes = board.cards.find((c: { employee: { firstName: string } }) => c.employee.firstName === 'Wes');
    expect(wes).toMatchObject({ workMode: 'REMOTE', employee: { firstName: 'Wes' } });
    expect(wes.checkIn).toBeTruthy();
    expect(board.cards.find((c: { employee: { firstName: string } }) => c.employee.firstName === 'Bree').breakSince).toBeTruthy();

    // A manager without org-wide access sees only their team (themself + direct reports).
    const team = await as(boss.token).get('/api/v1/attendance/board');
    expect(team.status).toBe(200);
    expect(team.body.data.scope).toBe('team');
    expect(team.body.data.cards.map((c: { employee: { firstName: string } }) => c.employee.firstName).sort()).toEqual(['Boss', 'Wes']);
    // A plain employee sees only their own team (manager + teammates), with colleagues' details withheld.
    const mate = await createEmployeeUser(admin.token, { firstName: 'Mo', managerId: boss.employee._id });
    const peers = await as(mate.token).get('/api/v1/attendance/board');
    expect(peers.status).toBe(200);
    expect(peers.body.data.scope).toBe('peers');
    type Card = { employee: { firstName: string }; restricted: boolean; column: string; checkIn: string | null; place: unknown; workMode: string | null };
    const byName = (n: string) => peers.body.data.cards.find((c: Card) => c.employee.firstName === n) as Card;
    expect(peers.body.data.cards.map((c: Card) => c.employee.firstName).sort()).toEqual(['Boss', 'Mo', 'Wes']);
    expect(byName('Wes')).toMatchObject({ column: 'WORKING', restricted: true, checkIn: null, place: null, workMode: null });
    expect(byName('Mo').restricted).toBe(false);
    // Without a manager, it's just themself; asking for the org-wide or team view is still refused.
    const solo = await as(idle.token).get('/api/v1/attendance/board');
    expect(solo.body.data.cards.map((c: Card) => c.employee.firstName)).toEqual(['Ian']);
    expect((await as(idle.token).get('/api/v1/attendance/board?scope=team')).status).toBe(403);
    expect((await as(idle.token).get('/api/v1/attendance/board?scope=all')).status).toBe(403);
  });
});
