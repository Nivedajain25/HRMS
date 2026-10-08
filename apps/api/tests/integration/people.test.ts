import { beforeAll, describe, expect, it } from 'vitest';
import { EmployeeModel, LeaveBalanceModel, OnboardingModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg, roleIds } from '../helpers';

describe('People: employees, org structure, RBAC & tenant isolation', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let deptId: string;
  let designationId: string;

  beforeAll(async () => {
    admin = await registerOrg();
    const d = await as(admin.token).post('/api/v1/departments', { name: 'Engineering', code: 'ENG' });
    expect(d.status).toBe(201);
    deptId = d.body.data._id;
    const g = await as(admin.token).post('/api/v1/designations', { name: 'Software Engineer', code: 'SE', level: 2, departmentId: deptId });
    expect(g.status).toBe(201);
    designationId = g.body.data._id;
  });

  it('creates an employee with user account, leave balances and onboarding in one step', async () => {
    const res = await as(admin.token).post('/api/v1/employees', {
      firstName: 'Grace',
      lastName: 'Hopper',
      workEmail: `grace.${Date.now()}@example.test`,
      joiningDate: '2024-03-01',
      gender: 'FEMALE',
      departmentId: deptId,
      designationId,
      bank: { bankName: 'Test Bank', accountNumber: '123456789012' },
      identity: { passport: 'P1234567' },
    });
    expect(res.status).toBe(201);
    const emp = res.body.data;
    expect(emp.employeeId).toMatch(/^EMP\d{4}$/);
    expect(emp.departmentId.name).toBe('Engineering');
    // Super admin holds read_sensitive, so decrypted values are visible.
    expect(emp.bank.accountNumber).toBe('123456789012');
    expect(emp.bank.accountNumberMasked).toMatch(/9012$/);

    // Stored encrypted at rest.
    const raw = await EmployeeModel.findById(emp._id).select('+bank +identity').lean();
    expect(raw?.bank?.accountNumberEncrypted).toMatch(/^enc:v1:/);
    expect(String(raw?.identity instanceof Map ? raw.identity.get('passport') : (raw?.identity as Record<string, string>)?.passport)).toMatch(/^enc:v1:/);

    expect(await LeaveBalanceModel.countDocuments({ employeeId: emp._id })).toBeGreaterThan(3);
    const onboarding = await OnboardingModel.findOne({ employeeId: emp._id }).lean();
    expect(onboarding?.tasks.length).toBeGreaterThan(5);
  });

  it('tracks history for department/designation/manager changes', async () => {
    const { employee } = await createEmployeeUser(admin.token, { firstName: 'Hist' });
    const mgr = await createEmployeeUser(admin.token, { firstName: 'Mgr' });
    const upd = await as(admin.token).patch(`/api/v1/employees/${employee._id}`, {
      departmentId: deptId,
      designationId,
      managerId: mgr.employee._id,
      changeReason: 'Promotion',
    });
    expect(upd.status).toBe(200);
    const hist = await as(admin.token).get(`/api/v1/employees/${employee._id}/history`);
    const fields = hist.body.data.map((h: { field: string }) => h.field).sort();
    expect(fields).toEqual(['department', 'designation', 'manager']);
    expect(hist.body.data.find((h: { field: string }) => h.field === 'department').newLabel).toBe('Engineering');
  });

  it('PATCH never resets omitted fields to schema defaults', async () => {
    const d = await as(admin.token).post('/api/v1/departments', { name: 'Legal', code: `LG${Date.now() % 1000}`, status: 'INACTIVE' });
    const upd = await as(admin.token).patch(`/api/v1/departments/${d.body.data._id}`, { name: 'Legal & Compliance' });
    expect(upd.body.data.status).toBe('INACTIVE');

    const { employee } = await createEmployeeUser(admin.token, { firstName: 'Contract', employmentType: 'CONTRACT', employmentStatus: 'PROBATION' });
    const e = await as(admin.token).patch(`/api/v1/employees/${employee._id}`, { phone: '+1 555 0199' });
    expect(e.body.data.employmentType).toBe('CONTRACT');
    expect(e.body.data.employmentStatus).toBe('PROBATION');
  });

  it('never widens onboarding visibility through search (regression)', async () => {
    const a = await createEmployeeUser(admin.token, { firstName: 'Searcher' });
    const b = await createEmployeeUser(admin.token, { firstName: 'Zebediah' });
    const own = await as(a.token).get('/api/v1/onboarding');
    expect(own.body.data.every((o: { employeeId: { _id: string } }) => o.employeeId._id === a.employee._id)).toBe(true);
    const probe = await as(a.token).get('/api/v1/onboarding?search=Zebediah');
    expect(probe.status).toBe(200);
    expect(probe.body.data).toHaveLength(0);
    // HR still finds it.
    const hr = await as(admin.token).get('/api/v1/onboarding?search=Zebediah');
    expect(hr.body.data.some((o: { employeeId: { _id: string } }) => o.employeeId._id === b.employee._id)).toBe(true);
  });

  it('prevents manager cycles', async () => {
    const a = await createEmployeeUser(admin.token, { firstName: 'A' });
    const b = await createEmployeeUser(admin.token, { firstName: 'B', managerId: a.employee._id });
    const cycle = await as(admin.token).patch(`/api/v1/employees/${a.employee._id}`, { managerId: b.employee._id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.code).toBe('HIERARCHY_CYCLE');
    const self = await as(admin.token).patch(`/api/v1/employees/${a.employee._id}`, { managerId: a.employee._id });
    expect(self.status).toBe(400);
  });

  it('scopes employee visibility: self, team, all', async () => {
    const mgr = await createEmployeeUser(admin.token, { firstName: 'Lead', roles: ['manager'] });
    const report = await createEmployeeUser(admin.token, { firstName: 'Report', managerId: mgr.employee._id });
    const outsider = await createEmployeeUser(admin.token, { firstName: 'Outsider' });

    // Plain employee: only self in the list, 403 on others (IDOR).
    const own = await as(report.token).get('/api/v1/employees');
    expect(own.body.data.map((e: { _id: string }) => e._id)).toEqual([report.employee._id]);
    expect((await as(report.token).get(`/api/v1/employees/${outsider.employee._id}`)).status).toBe(403);
    expect((await as(report.token).get(`/api/v1/employees/${report.employee._id}`)).status).toBe(200);

    // Manager: self + reports, not outsiders; personal fields hidden for reports.
    const team = await as(mgr.token).get('/api/v1/employees');
    const ids = team.body.data.map((e: { _id: string }) => e._id);
    expect(ids).toContain(report.employee._id);
    expect(ids).not.toContain(outsider.employee._id);
    const reportView = await as(mgr.token).get(`/api/v1/employees/${report.employee._id}`);
    expect(reportView.status).toBe(200);
    expect(reportView.body.data.dateOfBirth).toBeUndefined();
    expect(reportView.body.data.bank).toBeUndefined();
    expect((await as(mgr.token).get(`/api/v1/employees/${outsider.employee._id}`)).status).toBe(403);

    // Employees cannot create or update employees.
    expect((await as(report.token).post('/api/v1/employees', { firstName: 'x' })).status).toBe(403);
    expect((await as(report.token).patch(`/api/v1/employees/${report.employee._id}`, { firstName: 'Hacked' })).status).toBe(403);
    // ...but may update their own contact details.
    const selfUpd = await as(report.token).patch('/api/v1/employees/me', { phone: '+1 555 0100' });
    expect(selfUpd.status).toBe(200);
    expect(selfUpd.body.data.phone).toBe('+1 555 0100');
  });

  it('lists my manager and teammates (same manager only)', async () => {
    const mgr = await createEmployeeUser(admin.token, { firstName: 'Boss' });
    const me = await createEmployeeUser(admin.token, { firstName: 'Mia', managerId: mgr.employee._id });
    const peer = await createEmployeeUser(admin.token, { firstName: 'Peer', managerId: mgr.employee._id });
    const outsider = await createEmployeeUser(admin.token, { firstName: 'Else' });

    const res = await as(me.token).get('/api/v1/employees/teammates');
    expect(res.status).toBe(200);
    expect(res.body.data.manager._id).toBe(mgr.employee._id);
    const ids = res.body.data.teammates.map((e: { _id: string }) => e._id);
    expect(ids).toEqual([peer.employee._id]);
    expect(ids).not.toContain(outsider.employee._id);

    // No manager → empty team.
    const none = await as(outsider.token).get('/api/v1/employees/teammates');
    expect(none.body.data).toEqual({ manager: null, teammates: [] });
  });

  it('masks sensitive fields for HR without read_sensitive', async () => {
    const hr = await createEmployeeUser(admin.token, { firstName: 'Hrm', roles: ['hr_manager'] });
    const target = await as(admin.token).post('/api/v1/employees', {
      firstName: 'Bank',
      lastName: 'Holder',
      workEmail: `bank.${Date.now()}@example.test`,
      joiningDate: '2024-01-01',
      createUserAccount: false,
      bank: { bankName: 'B', accountNumber: '9876543210' },
    });
    const view = await as(hr.token).get(`/api/v1/employees/${target.body.data._id}`);
    expect(view.status).toBe(200);
    expect(view.body.data.bank.accountNumber).toBeUndefined();
    expect(view.body.data.bank.accountNumberMasked).toMatch(/3210$/);
    // And HR managers may not write bank details.
    const write = await as(hr.token).patch(`/api/v1/employees/${target.body.data._id}`, { bank: { accountNumber: '1111222233' } });
    expect(write.status).toBe(403);
  });

  it('blocks privilege escalation through roles and user management', async () => {
    const hrAdmin = await createEmployeeUser(admin.token, { firstName: 'HrAdm', roles: ['hr_admin'] });
    // hr_admin has user:manage but not settings:manage/role:manage → cannot assign super admin.
    const [superId] = await roleIds(admin.token, ['super_admin']);
    const victim = await createEmployeeUser(admin.token, { firstName: 'Victim' });
    const users = await as(admin.token).get('/api/v1/users?limit=100');
    const victimUser = users.body.data.find((u: { email: string }) => u.email === victim.email);
    const escalate = await as(hrAdmin.token).patch(`/api/v1/users/${victimUser._id}`, { roleIds: [superId] });
    expect(escalate.status).toBe(403);

    // No role management permission at all.
    expect((await as(hrAdmin.token).post('/api/v1/roles', { name: 'X', permissions: [] })).status).toBe(403);

    // Admin cannot demote the last super admin (themselves) nor edit own roles.
    const me = users.body.data.find((u: { email: string }) => u.email === admin.email);
    expect((await as(admin.token).patch(`/api/v1/users/${me._id}`, { roleIds: [superId] })).status).toBe(403);
  });

  it('edits a login’s name and email, keeping the linked employee in step', async () => {
    const emp = await createEmployeeUser(admin.token, { firstName: 'Renamed' });
    const other = await createEmployeeUser(admin.token, { firstName: 'Other' });
    const users = await as(admin.token).get('/api/v1/users?limit=100');
    const target = users.body.data.find((u: { email: string }) => u.email === emp.email);
    const newEmail = `edited-${Date.now()}@example.com`;

    const res = await as(admin.token).patch(`/api/v1/users/${target._id}`, { firstName: 'Priya', lastName: 'Sharma', email: newEmail.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: 'Priya', lastName: 'Sharma', email: newEmail });
    const employee = await EmployeeModel.findById(emp.employee._id).lean();
    expect(employee).toMatchObject({ firstName: 'Priya', lastName: 'Sharma', workEmail: newEmail });
    // They sign in with the new email from now on.
    expect((await as(admin.token).get('/api/v1/users?limit=100')).body.data.some((u: { email: string }) => u.email === emp.email)).toBe(false);

    // Emails stay unique.
    expect((await as(admin.token).patch(`/api/v1/users/${target._id}`, { email: other.email })).status).toBe(409);

    // Only a Super Admin can change a Super Admin's email.
    const hrAdmin = await createEmployeeUser(admin.token, { firstName: 'HrMail', roles: ['hr_admin'] });
    const me = users.body.data.find((u: { email: string }) => u.email === admin.email);
    expect((await as(hrAdmin.token).patch(`/api/v1/users/${me._id}`, { email: `takeover-${Date.now()}@example.com` })).status).toBe(403);
  });

  it('supports custom roles and enforces them immediately', async () => {
    const role = await as(admin.token).post('/api/v1/roles', {
      name: `Dept Admin ${Date.now()}`,
      permissions: ['department:manage'],
    });
    expect(role.status).toBe(201);
    const u = await createEmployeeUser(admin.token, { firstName: 'Custom' });
    expect((await as(u.token).post('/api/v1/departments', { name: 'Ops', code: `OPS${Date.now() % 1000}` })).status).toBe(403);
    const users = await as(admin.token).get('/api/v1/users?limit=100');
    const target = users.body.data.find((x: { email: string }) => x.email === u.email);
    const [employeeRole] = await roleIds(admin.token, ['employee']);
    await as(admin.token).patch(`/api/v1/users/${target._id}`, { roleIds: [employeeRole, role.body.data._id] });
    expect((await as(u.token).post('/api/v1/departments', { name: 'Ops2', code: `OP${Date.now() % 1000}` })).status).toBe(201);
    // Deleting an in-use role is blocked.
    expect((await as(admin.token).delete(`/api/v1/roles/${role.body.data._id}`)).status).toBe(422);
  });

  it('isolates tenants completely', async () => {
    const other = await registerOrg();
    const ours = await createEmployeeUser(admin.token, { firstName: 'Ours' });

    // Another org cannot read/update/archive our records by id.
    // 404 rather than 403: foreign records are indistinguishable from missing ones.
    expect((await as(other.token).get(`/api/v1/employees/${ours.employee._id}`)).status).toBe(404);
    expect((await as(other.token).patch(`/api/v1/employees/${ours.employee._id}`, { firstName: 'X' })).status).toBe(404);
    expect((await as(other.token).delete(`/api/v1/employees/${ours.employee._id}`)).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/departments/${deptId}`)).status).toBe(404);
    // Lists never include foreign records.
    const list = await as(other.token).get('/api/v1/employees?limit=100');
    expect(list.body.data.some((e: { _id: string }) => e._id === ours.employee._id)).toBe(false);
    // Cannot link to a foreign department.
    const link = await as(other.token).post('/api/v1/employees', {
      firstName: 'X',
      lastName: 'Y',
      workEmail: `x.${Date.now()}@example.test`,
      joiningDate: '2024-01-01',
      departmentId: deptId,
      createUserAccount: false,
    });
    expect(link.status).toBe(400);
    expect(link.body.code).toBe('INVALID_REFERENCE');
    // organizationId in the body is ignored/stripped by validation.
    const dept = await as(other.token).post('/api/v1/departments', { name: 'Sneaky', code: 'SNK', organizationId: admin.user.organization._id });
    expect(dept.status).toBe(201);
    expect(dept.body.data.organizationId).toBe(other.user.organization._id);
  });

  it('prevents archiving departments with employees and archives employees safely', async () => {
    const e = await createEmployeeUser(admin.token, { firstName: 'Arch', departmentId: deptId });
    expect((await as(admin.token).delete(`/api/v1/departments/${deptId}`)).status).toBe(422);
    expect((await as(admin.token).delete(`/api/v1/employees/${e.employee._id}`)).status).toBe(200);
    // Archived employee's account is deactivated.
    expect((await as(e.token).get('/api/v1/auth/me')).status).toBe(401);
  });
});
