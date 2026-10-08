import { describe, expect, it } from 'vitest';
import { as, createEmployeeUser, registerOrg } from '../helpers';

describe('Activity feed', () => {
  it('shows HR everyone’s activity and employees only their own', async () => {
    const admin = await registerOrg();
    expect((await as(admin.token).patch('/api/v1/organization/settings', { attendance: { requireSelfie: false, requireLocation: false } })).status).toBe(200);
    const hr = await createEmployeeUser(admin.token, { firstName: 'Hana', roles: ['hr_manager'] });
    const a = await createEmployeeUser(admin.token, { firstName: 'Asha' });
    const b = await createEmployeeUser(admin.token, { firstName: 'Bala' });

    expect((await as(a.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE' })).status).toBe(200);
    expect((await as(a.token).post('/api/v1/attendance/check-out')).status).toBe(200);
    expect((await as(b.token).post('/api/v1/attendance/check-in', { workMode: 'REMOTE' })).status).toBe(200);

    type Item = { type: string; employee: { name: string }; title: string };
    const everyone = await as(hr.token).get('/api/v1/dashboard/activity?scope=all');
    expect(everyone.status).toBe(200);
    const items = everyone.body.data as Item[];
    expect(items.filter((i) => i.type === 'CLOCK_IN').map((i) => i.employee.name.split(' ')[0]).sort()).toEqual(['Asha', 'Bala']);
    expect(items.some((i) => i.type === 'CLOCK_OUT' && i.employee.name.startsWith('Asha'))).toBe(true);
    expect(items.find((i) => i.type === 'CLOCK_IN')!.title).toBe('checked in remotely');

    // An employee sees only their own, and cannot ask for everyone's.
    const mine = (await as(b.token).get('/api/v1/dashboard/activity')).body.data as Item[];
    expect(mine.length).toBe(1);
    expect(mine[0]!.employee.name.startsWith('Bala')).toBe(true);
    expect((await as(b.token).get('/api/v1/dashboard/activity?scope=all')).status).toBe(403);
  });
});
