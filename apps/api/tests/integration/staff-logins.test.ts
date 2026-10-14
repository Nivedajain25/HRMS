import { describe, expect, it } from 'vitest';
import { as, registerOrg } from '../helpers';
import request from 'supertest';
import { createApp } from '../../src/app';

const app = createApp();

/** Staff added as records only (e.g. helping staff) get logins in one go, so they can check in like everyone else. */
describe('Logins for employees without one', () => {
  it('lists them, creates logins with activation links, and they can activate, sign in and check in', async () => {
    const admin = await registerOrg();
    const stamp = Date.now();
    const add = (firstName: string, extra: Record<string, unknown> = {}) =>
      as(admin.token).post('/api/v1/employees', {
        firstName,
        lastName: 'Staff',
        workEmail: `${firstName.toLowerCase()}.${stamp}@example.test`,
        joiningDate: '2024-01-01',
        createUserAccount: false,
        ...extra,
      });
    const lead = (await add('Lead')).body.data;
    const helper = (await add('Helper', { managerId: lead._id })).body.data;

    // Both are listed as unable to sign in.
    const missing = await as(admin.token).get('/api/v1/users/without-login');
    expect(missing.status).toBe(200);
    const names = missing.body.data.map((e: { firstName: string }) => e.firstName);
    expect(names).toEqual(expect.arrayContaining(['Lead', 'Helper']));

    // One click: logins for everyone without one.
    const res = await as(admin.token).post('/api/v1/users/employee-logins', {});
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.created.map((c: { name: string }) => [c.name, c]));
    expect(byName['Helper Staff'].url).toMatch(/\/accept-invite\?token=/);
    expect(byName['Lead Staff'].email).toBe(`lead.${stamp}@example.test`);
    expect((await as(admin.token).get('/api/v1/users/without-login')).body.data.some((e: { _id: string }) => e._id === helper._id)).toBe(false);

    // Roles: Employee for all, + Manager for whoever has people reporting to them.
    const users = await as(admin.token).get('/api/v1/users?limit=100');
    const roleKeys = (email: string) => users.body.data.find((u: { email: string }) => u.email === email).roles.map((r: { key: string }) => r.key).sort();
    expect(roleKeys(`helper.${stamp}@example.test`)).toEqual(['employee']);
    expect(roleKeys(`lead.${stamp}@example.test`)).toEqual(['employee', 'manager']);

    // The helper opens the link, sets their own password, signs in and checks in.
    const token = new URL(byName['Helper Staff'].url).searchParams.get('token');
    const activated = await request(app).post('/api/v1/auth/accept-invite').send({ token, password: 'Helper@2026x' });
    expect(activated.status).toBe(200);
    const login = await request(app).post('/api/v1/auth/login').send({ email: `helper.${stamp}@example.test`, password: 'Helper@2026x' });
    expect(login.status).toBe(200);
    const checkIn = await as(login.body.data.accessToken).post('/api/v1/attendance/check-in', { workMode: 'OFFICE' });
    expect(checkIn.status).toBe(200);

    // Logins made earlier with the same email but never connected to the record get connected, not duplicated.
    const roles = await as(admin.token).get('/api/v1/roles');
    const employeeRoleId = roles.body.data.find((r: { key: string }) => r.key === 'employee')._id;
    const active = (await add('Active')).body.data;
    const invited = (await add('Invited')).body.data;
    const activeUser = await as(admin.token).post('/api/v1/users', { email: `active.${stamp}@example.test`, firstName: 'Active', lastName: 'Staff', roleIds: [employeeRoleId], sendInvite: false });
    await as(admin.token).post('/api/v1/users', { email: `invited.${stamp}@example.test`, firstName: 'Invited', lastName: 'Staff', roleIds: [employeeRoleId], sendInvite: false });
    const activeLink = await as(admin.token).post(`/api/v1/users/${activeUser.body.data._id}/invite-link`);
    await request(app).post('/api/v1/auth/accept-invite').send({ token: new URL(activeLink.body.data.url).searchParams.get('token'), password: 'Active@2026x' });
    const before = await request(app).post('/api/v1/auth/login').send({ email: `active.${stamp}@example.test`, password: 'Active@2026x' });
    expect((await as(before.body.data.accessToken).post('/api/v1/attendance/check-in', { workMode: 'OFFICE' })).status).not.toBe(200); // no employee profile yet

    const second = await as(admin.token).post('/api/v1/users/employee-logins', {});
    expect(second.body.data.linked.map((l: { name: string }) => l.name)).toEqual(['Active Staff']);
    expect(second.body.data.created).toEqual([expect.objectContaining({ name: 'Invited Staff', linked: true, url: expect.stringContaining('/accept-invite?token=') })]);
    const usersAfter = (await as(admin.token).get('/api/v1/users?limit=100')).body.data as { email: string; employeeId: { _id: string } | null }[];
    expect(usersAfter.filter((u) => u.email.startsWith('active.')).length).toBe(1);
    expect(usersAfter.find((u) => u.email === `active.${stamp}@example.test`)?.employeeId?._id).toBe(active._id);
    expect(usersAfter.find((u) => u.email === `invited.${stamp}@example.test`)?.employeeId?._id).toBe(invited._id);
    const after = await request(app).post('/api/v1/auth/login').send({ email: `active.${stamp}@example.test`, password: 'Active@2026x' });
    expect((await as(after.body.data.accessToken).post('/api/v1/attendance/check-in', { workMode: 'OFFICE' })).status).toBe(200);

    // Running it again does nothing (everyone has a login now); employees can't use it.
    expect((await as(admin.token).post('/api/v1/users/employee-logins', {})).body.data.created).toEqual([]);
    expect((await as(login.body.data.accessToken).post('/api/v1/users/employee-logins', {})).status).toBe(403);
  });
});
