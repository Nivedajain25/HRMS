import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@stencil/shared';
import { AuditLogModel, EmployeeModel, NotificationModel, RoleModel, UserModel } from '../../src/models';
import { ensureSystemRoles } from '../../src/services/organization-setup.service';
import { as, createEmployeeUser, registerOrg, roleIds, uniqueEmail } from '../helpers';

describe('Admin role (everything but Super-Admin-only controls)', () => {
  it('exists for new organizations and is added to existing ones without touching other roles', async () => {
    const admin = await registerOrg();
    const roles = (await as(admin.token).get('/api/v1/roles')).body.data as { key?: string; name: string; permissions: string[]; isSystem: boolean }[];
    const adminRole = roles.find((r) => r.key === 'admin');
    expect(adminRole).toMatchObject({ name: 'Admin', isSystem: true });
    expect(adminRole!.permissions).toHaveLength(ALL_PERMISSIONS.length);

    // An organization created before the role existed gets it on startup; existing roles stay as they are.
    const orgId = admin.user.organization._id;
    await RoleModel.deleteOne({ organizationId: orgId, key: 'admin' });
    await RoleModel.updateOne({ organizationId: orgId, key: 'employee' }, { $set: { permissions: ['leave:read'] } });
    await ensureSystemRoles();
    await ensureSystemRoles(); // idempotent
    expect(await RoleModel.countDocuments({ organizationId: orgId, key: 'admin' })).toBe(1);
    expect((await RoleModel.findOne({ organizationId: orgId, key: 'employee' }).lean())!.permissions).toEqual(['leave:read']);
  });

  it('cannot switch breaks or hand out / take away Super Admin, but can run everything else', async () => {
    const owner = await registerOrg();
    const nitin = await createEmployeeUser(owner.token, { firstName: 'Nitin', roles: ['admin'] });
    const staff = await createEmployeeUser(owner.token, { firstName: 'Staff' });
    const [superId, adminId, employeeId, hrAdminId] = await roleIds(owner.token, ['super_admin', 'admin', 'employee', 'hr_admin']);
    const users = (await as(owner.token).get('/api/v1/users?limit=100')).body.data as { _id: string; email: string }[];
    const idOf = (email: string) => users.find((u) => u.email === email)!._id;

    // Breaks on / off stays with the Super Admin.
    const breaks = await as(nitin.token).patch('/api/v1/organization/settings', { attendance: { allowBreaks: true } });
    expect(breaks.status).toBe(403);
    expect(breaks.body.code).toBe('SUPER_ADMIN_ONLY');
    expect((await as(owner.token).patch('/api/v1/organization/settings', { attendance: { allowBreaks: true } })).status).toBe(200);

    // The Super Admin role: can't be granted, and a Super Admin can't be demoted or deactivated by an Admin.
    const grant = await as(nitin.token).patch(`/api/v1/users/${idOf(staff.email)}`, { roleIds: [employeeId, superId] });
    expect(grant.status).toBe(403);
    expect(grant.body.code).toBe('SUPER_ADMIN_ONLY');
    const invite = await as(nitin.token).post('/api/v1/users', { email: uniqueEmail('x'), firstName: 'X', lastName: 'Y', roleIds: [superId], sendInvite: false });
    expect(invite.status).toBe(403);
    expect((await as(nitin.token).patch(`/api/v1/users/${idOf(owner.user.email)}`, { roleIds: [adminId] })).body.code).toBe('SUPER_ADMIN_ONLY');
    expect((await as(nitin.token).patch(`/api/v1/users/${idOf(owner.user.email)}`, { status: 'INACTIVE' })).body.code).toBe('SUPER_ADMIN_ONLY');
    // Neither the Admin nor the Super Admin role can be edited.
    expect((await as(nitin.token).put(`/api/v1/roles/${adminId}`, { name: 'Admin', permissions: [] })).status).toBe(403);

    // Everything else works: e.g. making someone HR Admin, and the full-access dashboard data.
    expect((await as(nitin.token).patch(`/api/v1/users/${idOf(staff.email)}`, { roleIds: [employeeId, hrAdminId] })).status).toBe(200);
    expect((await as(nitin.token).get('/api/v1/recruitment/referrals/summary')).status).toBe(200);
    expect((await as(nitin.token).get('/api/v1/attendance/board')).status).toBe(200);

    // The Super Admin can make the Admin a Super Admin (and back).
    expect((await as(owner.token).patch(`/api/v1/users/${idOf(nitin.email)}`, { roleIds: [employeeId, superId] })).status).toBe(200);
    expect((await as(owner.token).patch(`/api/v1/users/${idOf(nitin.email)}`, { roleIds: [adminId] })).status).toBe(200);
  });

  it('lets only the Super Admin delete a login, keeping the employee record and history', async () => {
    const owner = await registerOrg();
    const nitin = await createEmployeeUser(owner.token, { firstName: 'Nitin', roles: ['admin'] });
    const suchi = await createEmployeeUser(owner.token, { firstName: 'Suchi' });
    const users = (await as(owner.token).get('/api/v1/users?limit=100')).body.data as { _id: string; email: string }[];
    const idOf = (email: string) => users.find((u) => u.email === email)!._id;
    const suchiUserId = idOf(suchi.email);
    await NotificationModel.create({ organizationId: owner.user.organization._id, userId: suchiUserId, type: 'GENERAL', title: 'Hi', message: 'Hello' });
    expect((await as(suchi.token).get('/api/v1/auth/me')).status).toBe(200);

    // The Admin (and anyone else) can't; nobody can delete themselves.
    const byAdmin = await as(nitin.token).delete(`/api/v1/users/${suchiUserId}`);
    expect(byAdmin.status).toBe(403);
    expect(byAdmin.body.code).toBe('SUPER_ADMIN_ONLY');
    expect((await as(owner.token).delete(`/api/v1/users/${idOf(owner.user.email)}`)).status).toBe(403);

    const res = await as(owner.token).delete(`/api/v1/users/${suchiUserId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ deleted: true, employeeKept: suchi.employee.employeeId });

    // Gone and signed out; the employee record stays (unlinked) and their notifications are removed.
    expect(await UserModel.exists({ _id: suchiUserId })).toBeNull();
    expect((await as(suchi.token).get('/api/v1/auth/me')).status).toBe(401);
    const emp = await EmployeeModel.findById(suchi.employee._id).lean();
    expect(emp).toBeTruthy();
    expect(emp!.userId).toBeNull();
    expect(await NotificationModel.countDocuments({ userId: suchiUserId })).toBe(0);
    expect((await AuditLogModel.findOne({ action: 'USER_DELETED', recordId: suchiUserId }).lean())?.recordLabel).toBe(suchi.email);

    // The email is free again, and the record can be linked to a new login.
    const [employeeRole] = await roleIds(owner.token, ['employee']);
    const again = await as(owner.token).post('/api/v1/users', { email: suchi.email, firstName: 'Suchi', lastName: 'Again', roleIds: [employeeRole], employeeId: suchi.employee._id, sendInvite: false });
    expect(again.status).toBe(201);
    expect((await as(owner.token).delete(`/api/v1/users/${suchiUserId}`)).status).toBe(404);
  });

  it('lets the Super Admin take a login off the staff list (the boss), keeping the login', async () => {
    const owner = await registerOrg();
    const boss = await createEmployeeUser(owner.token, { firstName: 'Boss', roles: ['admin'] });
    const report = await createEmployeeUser(owner.token, { firstName: 'Report', managerId: boss.employee._id });
    const users = (await as(owner.token).get('/api/v1/users?limit=100')).body.data as { _id: string; email: string }[];
    const bossUserId = users.find((u) => u.email === boss.email)!._id;

    // Only the Super Admin.
    const byAdmin = await as(boss.token).delete(`/api/v1/users/${bossUserId}/employee`);
    expect(byAdmin.status).toBe(403);

    const res = await as(owner.token).delete(`/api/v1/users/${bossUserId}/employee`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ employee: boss.employee.employeeId, reportsUnassigned: [{ employeeId: report.employee.employeeId }] });

    // The login still works, as Admin, without an employee record.
    const me = await as(boss.token).get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.employeeId).toBeNull();
    expect(me.body.data.roles.map((r: { key: string }) => r.key)).toContain('admin');
    expect((await UserModel.findById(bossUserId).lean())?.status).toBe('ACTIVE');

    // The record is archived (off the staff list) and their report has no manager now.
    const emp = await EmployeeModel.findById(boss.employee._id).lean();
    expect(emp).toMatchObject({ employmentStatus: 'ARCHIVED', userId: null });
    expect(emp!.deletedAt).toBeTruthy();
    expect((await EmployeeModel.findById(report.employee._id).lean())?.managerId).toBeNull();

    // Nothing left to remove.
    expect((await as(owner.token).delete(`/api/v1/users/${bossUserId}/employee`)).status).toBe(422);
  });
});
