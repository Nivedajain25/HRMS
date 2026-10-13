import { describe, expect, it } from 'vitest';
import { as, createEmployeeUser, registerOrg } from '../helpers';

/** Employee codes are optional: e.g. the managing director has none. Codes that exist stay unique. */
describe('Employee ID (code)', () => {
  it('can be removed (blank), several people can have none, and a taken code is refused', async () => {
    const admin = await registerOrg();
    const md = await createEmployeeUser(admin.token, { firstName: 'Nitin' });
    const director = await createEmployeeUser(admin.token, { firstName: 'Dina' });
    const staff = await createEmployeeUser(admin.token, { firstName: 'Sam' });

    const before = await as(admin.token).get(`/api/v1/employees/${md.employee._id}`);
    expect(before.body.data.employeeId).toMatch(/^[A-Z]+\d{4}$/);

    // Blank → no employee ID.
    const cleared = await as(admin.token).patch(`/api/v1/employees/${md.employee._id}`, { employeeId: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.employeeId).toBeNull();
    // A second person without a code is fine (only existing codes must be unique).
    expect((await as(admin.token).patch(`/api/v1/employees/${director.employee._id}`, { employeeId: null })).status).toBe(200);

    // Lists, search and the profile still work for people without a code.
    const list = await as(admin.token).get('/api/v1/employees?search=Nitin');
    expect(list.status).toBe(200);
    expect(list.body.data.find((e: { _id: string }) => e._id === md.employee._id)?.employeeId).toBeNull();
    expect((await as(admin.token).get(`/api/v1/employees/${md.employee._id}`)).body.data.employeeId).toBeNull();

    // Someone else's code is refused; a new free code can be given.
    const staffCode = (await as(admin.token).get(`/api/v1/employees/${staff.employee._id}`)).body.data.employeeId as string;
    const taken = await as(admin.token).patch(`/api/v1/employees/${director.employee._id}`, { employeeId: staffCode });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('EMPLOYEE_ID_TAKEN');
    const given = await as(admin.token).patch(`/api/v1/employees/${director.employee._id}`, { employeeId: 'DIR-01' });
    expect(given.body.data.employeeId).toBe('DIR-01');

    // New employees still get an auto-generated code.
    const next = await createEmployeeUser(admin.token, { firstName: 'Neha' });
    expect((await as(admin.token).get(`/api/v1/employees/${next.employee._id}`)).body.data.employeeId).toMatch(/^[A-Z]+\d{4}$/);
  });
});
