import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AssetModel,
  AttendanceModel,
  CandidateModel,
  EmployeeModel,
  GoalModel,
  JobOpeningModel,
  LeaveRequestModel,
  LeaveTypeModel,
} from '../../src/models';
import { addDaysKey, dateOnly, todayKey } from '../../src/utils/dates';
import { as, createEmployeeUser, registerOrg } from '../helpers';

type SearchHit = { type: string; id: string; title: string; url: string };

describe('Insights: audit logs, search, dashboards, reports', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let manager: Awaited<ReturnType<typeof createEmployeeUser>>;
  let emp: Awaited<ReturnType<typeof createEmployeeUser>>;
  let other: Awaited<ReturnType<typeof createEmployeeUser>>;
  let hrm: Awaited<ReturnType<typeof createEmployeeUser>>;
  let orgId: Types.ObjectId;
  let candidateId: string;
  const today = todayKey('UTC');

  const file = (token: string, url: string) => as(token).get(url).buffer(true).responseType('blob');

  beforeAll(async () => {
    admin = await registerOrg();
    orgId = new Types.ObjectId(admin.user.organization._id);
    manager = await createEmployeeUser(admin.token, { roles: ['manager'], firstName: 'Mona' });
    emp = await createEmployeeUser(admin.token, { firstName: 'Evan', lastName: 'Stone', managerId: manager.employee._id });
    other = await createEmployeeUser(admin.token, { firstName: 'Olga', lastName: 'Frost' });
    hrm = await createEmployeeUser(admin.token, { roles: ['hr_manager'], firstName: 'Hana' });

    const cl = await LeaveTypeModel.findOne({ organizationId: orgId, code: 'CL' }).lean();
    const now = new Date();
    await AttendanceModel.create([
      { organizationId: orgId, employeeId: emp.employee._id, date: dateOnly(today), checkIn: new Date(now.getTime() - 3_600_000), status: 'LATE', isLate: true, lateMinutes: 20 },
      { organizationId: orgId, employeeId: manager.employee._id, date: dateOnly(today), checkIn: new Date(now.getTime() - 7_200_000), status: 'PRESENT' },
    ]);
    await LeaveRequestModel.create([
      {
        organizationId: orgId,
        employeeId: other.employee._id,
        leaveTypeId: cl!._id,
        startDate: dateOnly(today),
        endDate: dateOnly(today),
        days: 1,
        reason: 'Personal',
        status: 'APPROVED',
        approvalSteps: [{ approverType: 'HR', status: 'APPROVED' }],
      },
      {
        organizationId: orgId,
        employeeId: emp.employee._id,
        leaveTypeId: cl!._id,
        startDate: dateOnly(addDaysKey(today, 7)),
        endDate: dateOnly(addDaysKey(today, 7)),
        days: 1,
        reason: 'Errand',
        status: 'SUBMITTED',
        approvalSteps: [{ approverType: 'MANAGER', status: 'PENDING' }],
        currentStep: 0,
        currentApproverType: 'MANAGER',
        submittedAt: now,
      },
    ]);
    await GoalModel.create([
      { organizationId: orgId, employeeId: emp.employee._id, title: 'Goal A', progress: 40, status: 'IN_PROGRESS' },
      { organizationId: orgId, employeeId: emp.employee._id, title: 'Goal B', progress: 100, status: 'COMPLETED' },
    ]);
    await EmployeeModel.updateOne({ _id: other.employee._id }, { dateOfBirth: dateOnly(`1991-${addDaysKey(today, 5).slice(5)}`) });

    const job = await JobOpeningModel.create({ organizationId: orgId, code: 'JOB-9001', title: 'Zephyr Engineer', description: 'Build things', status: 'OPEN' });
    const cand = await CandidateModel.create({ organizationId: orgId, jobId: job._id, firstName: 'Zephyr', lastName: 'Quill', email: 'zq@example.test' });
    candidateId = String(cand._id);
    await AssetModel.create({ organizationId: orgId, assetTag: 'ZL-1', name: 'Zephyr Laptop', category: 'LAPTOP', status: 'ASSIGNED', currentEmployeeId: other.employee._id, purchaseCost: 1000 });
  });

  /* ------------------------------ Audit logs ----------------------------- */

  it('restricts audit logs to audit:read and supports filters', async () => {
    expect((await as(emp.token).get('/api/v1/audit-logs')).status).toBe(403);
    expect((await as(hrm.token).get('/api/v1/audit-logs')).status).toBe(403);

    const all = await as(admin.token).get('/api/v1/audit-logs?limit=100');
    expect(all.status).toBe(200);
    const times = all.body.data.map((l: { timestamp: string }) => new Date(l.timestamp).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const created = await as(admin.token).get('/api/v1/audit-logs?action=EMPLOYEE_CREATED&limit=100');
    expect(created.body.data.length).toBeGreaterThanOrEqual(4);
    expect(created.body.data.every((l: { action: string }) => l.action === 'EMPLOYEE_CREATED')).toBe(true);

    const search = await as(admin.token).get('/api/v1/audit-logs?search=evan');
    expect(search.body.data.length).toBeGreaterThanOrEqual(1);
    expect(search.body.data.every((l: { recordLabel?: string; userName?: string }) => /evan/i.test(`${l.recordLabel} ${l.userName}`))).toBe(true);

    const byRecord = await as(admin.token).get(`/api/v1/audit-logs?recordId=${emp.employee._id}&module=employees`);
    expect(byRecord.body.data.every((l: { recordId: string }) => l.recordId === emp.employee._id)).toBe(true);

    const future = await as(admin.token).get(`/api/v1/audit-logs?from=${addDaysKey(today, 1)}`);
    expect(future.body.pagination.total).toBe(0);
    const todays = await as(admin.token).get(`/api/v1/audit-logs?from=${today}&to=${today}`);
    expect(todays.body.pagination.total).toBeGreaterThan(0);

    expect((await as(admin.token).get('/api/v1/audit-logs?action=NOPE')).status).toBe(400);
    expect((await as(admin.token).delete(`/api/v1/audit-logs/${all.body.data[0]._id}`)).status).toBe(404);
  });

  it('exposes record activity to the employee themself and their manager only', async () => {
    const own = await as(emp.token).get(`/api/v1/audit-logs/record/employees/${emp.employee._id}`);
    expect(own.status).toBe(200);
    expect(own.body.data.some((l: { action: string }) => l.action === 'EMPLOYEE_CREATED')).toBe(true);
    expect(own.body.data[0].ipAddress).toBeUndefined();

    expect((await as(manager.token).get(`/api/v1/audit-logs/record/employees/${emp.employee._id}`)).status).toBe(200);
    expect((await as(emp.token).get(`/api/v1/audit-logs/record/employees/${other.employee._id}`)).status).toBe(403);
    expect((await as(emp.token).get(`/api/v1/audit-logs/record/leave/${emp.employee._id}`)).status).toBe(403);
    expect((await as(admin.token).get(`/api/v1/audit-logs/record/employees/${other.employee._id}`)).status).toBe(200);
  });

  /* -------------------------------- Search ------------------------------- */

  it('searches across modules while respecting permissions', async () => {
    expect((await as(emp.token).get('/api/v1/search?q=a')).status).toBe(400);

    const asEmp = await as(emp.token).get('/api/v1/search?q=zeph');
    expect(asEmp.status).toBe(200);
    const empTypes = (asEmp.body.data as SearchHit[]).map((h) => h.type);
    expect(empTypes).not.toContain('candidate');
    expect(empTypes).not.toContain('asset');

    const asAdmin = await as(admin.token).get('/api/v1/search?q=zeph');
    const cand = (asAdmin.body.data as SearchHit[]).find((h) => h.type === 'candidate');
    expect(cand).toMatchObject({ id: candidateId, title: 'Zephyr Quill', url: `/recruitment/candidates/${candidateId}` });
    expect((asAdmin.body.data as SearchHit[]).some((h) => h.type === 'asset' && h.url.startsWith('/assets/'))).toBe(true);

    // Directory hits are visible to everyone (basic fields only).
    const people = await as(emp.token).get('/api/v1/search?q=olga fr&types=employee');
    expect(people.body.data).toHaveLength(1);
    expect(people.body.data[0]).toMatchObject({ type: 'employee', title: 'Olga Frost', url: `/employees/${other.employee._id}` });

    // Leave: own requests only for a plain employee.
    const leaves = await as(emp.token).get('/api/v1/search?q=casual&types=leave');
    expect(leaves.body.data.length).toBe(1);
    expect(leaves.body.data[0].title).toContain('Evan Stone');
    const adminLeaves = await as(admin.token).get('/api/v1/search?q=casual&types=leave');
    expect(adminLeaves.body.data.length).toBe(2);

    await as(admin.token).post('/api/v1/departments', { name: 'Zephyrology', code: 'ZEP' });
    const depts = await as(emp.token).get('/api/v1/search?q=zeph&types=department');
    expect((depts.body.data as SearchHit[]).every((h) => h.type === 'department')).toBe(true);
    expect(depts.body.data[0]).toMatchObject({ title: 'Zephyrology', url: '/departments' });

    // Regex metacharacters are treated literally.
    expect((await as(admin.token).get('/api/v1/search?q=.*')).body.data).toEqual([]);
  });

  /* ------------------------------ Dashboards ----------------------------- */

  it('computes the admin dashboard from real data', async () => {
    expect((await as(emp.token).get('/api/v1/dashboard/admin')).status).toBe(403);
    const res = await as(admin.token).get('/api/v1/dashboard/admin');
    expect(res.status).toBe(200);
    const { cards, charts, widgets } = res.body.data;
    expect(cards).toMatchObject({ totalEmployees: 5, activeEmployees: 5, presentToday: 2, lateToday: 1, onTimeToday: 1, onLeaveToday: 1, absentToday: 0, openJobs: 1 });
    expect(cards.pendingApprovals).toMatchObject({ leave: 1, expense: 0, regularization: 0, total: 1 });
    expect(cards.payroll).toBeNull();
    // Role dashboards (HR / Head) extras.
    const { insights } = res.body.data;
    // New hires in this org start onboarding automatically.
    expect(insights).toMatchObject({ onboardingInProgress: expect.any(Number), offboardingInProgress: 0, exitsThisMonth: [], payrollPrevious: null });
    expect(insights.onboardingInProgress).toBeGreaterThan(0);
    expect(Array.isArray(insights.joinersThisMonth)).toBe(true);
    expect(typeof insights.pipeline).toBe('number');
    expect(insights.attendanceRateMonth === null || (insights.attendanceRateMonth >= 0 && insights.attendanceRateMonth <= 100)).toBe(true);
    expect(charts.employeeGrowth).toHaveLength(12);
    expect(charts.employeeGrowth[11].headcount).toBe(5);
    expect(charts.attendanceTrend).toHaveLength(14);
    expect(charts.attendanceTrend[13]).toMatchObject({ date: today, present: 2, late: 1 });
    expect(charts.leaveTrend.months).toHaveLength(6);
    expect(charts.employmentTypeDistribution[0]).toEqual({ type: 'FULL_TIME', count: 5 });
    expect(charts.departmentDistribution[0]).toMatchObject({ name: 'Unassigned', count: 5 });

    const bday = widgets.upcomingBirthdays.find((b: { _id: string }) => b._id === other.employee._id);
    expect(bday).toMatchObject({ date: addDaysKey(today, 5).slice(5), inDays: 5 });
    // Birth year is never exposed.
    expect(bday).not.toHaveProperty('dateOfBirth');
    expect(bday.nextDate.startsWith('1991')).toBe(false);
    expect(widgets.recentActivities.length).toBeGreaterThan(0);
    expect(widgets.pendingApprovals).toHaveLength(1);
    expect(widgets.pendingApprovals[0]).toMatchObject({ type: 'leave', employee: 'Evan Stone', awaiting: 'MANAGER' });

    // hr_manager: no audit:read → no activity feed; no payroll card.
    const hr = await as(hrm.token).get('/api/v1/dashboard/admin');
    expect(hr.status).toBe(200);
    expect(hr.body.data.widgets.recentActivities).toEqual([]);
  });

  it('computes the manager and employee dashboards', async () => {
    expect((await as(emp.token).get('/api/v1/dashboard/manager')).status).toBe(403);
    const m = await as(manager.token).get('/api/v1/dashboard/manager');
    expect(m.status).toBe(200);
    expect(m.body.data).toMatchObject({ teamSize: 1, directReports: 1 });
    expect(m.body.data.attendanceToday).toMatchObject({ present: 1, late: 1, onLeave: 0 });
    expect(m.body.data.pendingLeave.count).toBe(1);
    expect(m.body.data.goals).toMatchObject({ total: 2, averageProgress: 70, byStatus: { IN_PROGRESS: 1, COMPLETED: 1 } });
    expect(m.body.data.pendingExpenses.count).toBe(0);

    const e = await as(emp.token).get('/api/v1/dashboard/employee');
    expect(e.status).toBe(200);
    expect(e.body.data.today.status).toBe('LATE');
    expect(e.body.data.workedMinutes).toBeGreaterThanOrEqual(59);
    expect(e.body.data.leaveBalances.length).toBeGreaterThan(0);
    expect(e.body.data.leaveBalances[0]).toHaveProperty('remaining');
    expect(e.body.data.goals).toHaveLength(1);
    expect(e.body.data.payslips).toEqual([]);
    expect(typeof e.body.data.unreadNotifications).toBe('number');
  });

  /* -------------------------------- Reports ------------------------------ */

  it('lists reports by permission and denies unauthorized users', async () => {
    const all = await as(admin.token).get('/api/v1/reports');
    expect(all.body.data.map((r: { type: string }) => r.type)).toHaveLength(9);
    const hr = await as(hrm.token).get('/api/v1/reports');
    const hrTypes = hr.body.data.map((r: { type: string }) => r.type);
    expect(hrTypes).toContain('employees');
    expect(hrTypes).toContain('attendance_log');
    expect(hrTypes).toContain('recruitment');
    expect(hrTypes).not.toContain('payroll');
    expect(hrTypes).not.toContain('expenses');
    expect((await as(hrm.token).get('/api/v1/reports/payroll')).status).toBe(403);
    expect((await as(hrm.token).get('/api/v1/reports/employees')).status).toBe(200);
    expect((await as(emp.token).get('/api/v1/reports/employees')).status).toBe(403);
    expect((await as(emp.token).get('/api/v1/reports')).status).toBe(403);
    expect((await as(admin.token).get('/api/v1/reports/unknown')).status).toBe(400);
  });

  it('returns JSON reports with columns, rows and summary', async () => {
    const res = await as(admin.token).get('/api/v1/reports/employees');
    expect(res.status).toBe(200);
    expect(res.body.data.columns.map((c: { key: string }) => c.key)).toEqual([
      'code', 'name', 'email', 'department', 'designation', 'location', 'manager', 'employmentType', 'status', 'joiningDate',
    ]);
    expect(res.body.data.rows).toHaveLength(5);
    expect(res.body.data.summary.totalRows).toBe(5);
    const evan = res.body.data.rows.find((r: { name: string }) => r.name === 'Evan Stone');
    expect(evan.manager).toBe('Mona Person');
    expect(JSON.stringify(res.body.data)).not.toMatch(/accountNumber|identity/);

    const paged = await as(admin.token).get('/api/v1/reports/employees?limit=2&page=2');
    expect(paged.body.data.rows).toHaveLength(2);
    expect(paged.body.data.pagination).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });

    const att = await as(admin.token).get(`/api/v1/reports/attendance?from=${today}&to=${today}`);
    expect(att.status).toBe(200);
    const evanAtt = att.body.data.rows.find((r: { name: string }) => r.name === 'Evan Stone');
    expect(evanAtt).toMatchObject({ present: 1, late: 1, absent: 0 });
    const olgaAtt = att.body.data.rows.find((r: { name: string }) => r.name === 'Olga Frost');
    expect(olgaAtt.leave).toBeGreaterThanOrEqual(0);

    const leave = await as(admin.token).get(`/api/v1/reports/leave?from=${today}&to=${addDaysKey(today, 10)}`);
    expect(leave.body.data.summary.byStatus).toMatchObject({ APPROVED: 1, SUBMITTED: 1 });

    const assets = await as(admin.token).get('/api/v1/reports/assets');
    expect(assets.body.data.summary.totalValue).toBe(1000);
    const rec = await as(admin.token).get('/api/v1/reports/recruitment');
    expect(rec.body.data.rows[0]).toMatchObject({ code: 'JOB-9001', APPLIED: 1, totalCandidates: 1 });
    expect((await as(admin.token).get('/api/v1/reports/leave?from=2025-02-01&to=2025-01-01')).status).toBe(400);
  });

  it('exports CSV with BOM, header row and formula-injection escaping', async () => {
    await EmployeeModel.updateOne({ _id: other.employee._id }, { firstName: '=SUM(1,2)' });
    const res = await file(admin.token, '/api/v1/reports/employees?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="stencil-employees-report-\d{4}-\d{2}-\d{2}\.csv"$/);
    const buf = res.body as Buffer;
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8').slice(1);
    expect(text.split('\r\n')[0]).toBe('Employee ID,Name,Work email,Department,Designation,Location,Manager,Employment type,Status,Joining date');
    expect(text).toContain(`"'=SUM(1,2) Frost"`);
    expect(text).not.toMatch(/(^|,)=SUM/m);
    await EmployeeModel.updateOne({ _id: other.employee._id }, { firstName: 'Olga' });
  });

  it('exports XLSX and PDF files', async () => {
    const x = await file(admin.token, '/api/v1/reports/attendance?format=xlsx');
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(x.headers['content-disposition']).toMatch(/stencil-attendance-report-\d{4}-\d{2}-\d{2}\.xlsx/);
    expect((x.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');

    const p = await file(admin.token, '/api/v1/reports/employees?format=pdf');
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toBe('application/pdf');
    expect((p.body as Buffer).subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect((p.body as Buffer).length).toBeGreaterThan(1000);

    const denied = await file(hrm.token, '/api/v1/reports/payroll?format=pdf');
    expect(denied.status).toBe(403);
  });
});
