import { describe, expect, it } from 'vitest';
import { NotificationModel } from '../../src/models';
import { as, createEmployeeUser, lastEmailTo, registerOrg } from '../helpers';

describe('Emergency alerts', () => {
  it('alerts HR and the manager at once, then tells the employee when HR responds', async () => {
    const admin = await registerOrg();
    const hr = await createEmployeeUser(admin.token, { firstName: 'Hana', roles: ['hr_manager'] });
    const boss = await createEmployeeUser(admin.token, { firstName: 'Boss', roles: ['manager'] });
    const emp = await createEmployeeUser(admin.token, { firstName: 'Eli', managerId: boss.employee._id, phone: '+91 98765 43210' });
    const other = await createEmployeeUser(admin.token, { firstName: 'Olga' });

    const raised = await as(emp.token).post('/api/v1/emergencies', { category: 'FAMILY', message: 'Father admitted to hospital', latitude: 12.97, longitude: 77.59 });
    expect(raised.status).toBe(201);
    const id = raised.body.data._id as string;
    expect(raised.body.data).toMatchObject({ status: 'OPEN', category: 'FAMILY', needToLeave: true, contactPhone: '+91 98765 43210' });
    expect(raised.body.data.location).toMatchObject({ latitude: 12.97, longitude: 77.59 });

    // HR and the manager got an EMERGENCY notification (and an email, even though it isn't emailed by default).
    const alerted = await NotificationModel.find({ type: 'EMERGENCY', entityId: id }).lean();
    const recipients = alerted.map((n) => String(n.userId));
    expect(recipients).toContain(String(hr.employee.userId?._id ?? hr.employee.userId));
    expect(recipients).toContain(String(boss.employee.userId?._id ?? boss.employee.userId));
    expect(alerted[0]!.title).toContain('Family emergency');
    expect(alerted[0]!.message).toContain('needs to leave work now');
    expect(lastEmailTo(hr.email)?.text ?? '').toContain('Father admitted to hospital');

    // A second alert while one is active is refused.
    expect((await as(emp.token).post('/api/v1/emergencies', { category: 'OTHER' })).body.code).toBe('EMERGENCY_ALREADY_OPEN');

    // HR sees it on the active list; colleagues can't see or act on it.
    const active = await as(hr.token).get('/api/v1/emergencies/active');
    expect(active.body.data.map((e: { _id: string }) => e._id)).toContain(id);
    expect((await as(other.token).get(`/api/v1/emergencies/${id}`)).status).toBe(403);
    expect((await as(other.token).get('/api/v1/emergencies/active')).status).toBe(403);
    expect((await as(emp.token).patch(`/api/v1/emergencies/${id}`, { status: 'RESOLVED' })).status).toBe(403);

    // Acknowledge → the employee is told; resolve with a note → closed, off the active list.
    const ack = await as(hr.token).patch(`/api/v1/emergencies/${id}`, { status: 'ACKNOWLEDGED' });
    expect(ack.body.data.status).toBe('ACKNOWLEDGED');
    const empUser = emp.employee.userId?._id ?? emp.employee.userId;
    expect(await NotificationModel.countDocuments({ type: 'EMERGENCY', userId: empUser })).toBe(1);
    const done = await as(hr.token).patch(`/api/v1/emergencies/${id}`, { status: 'RESOLVED', note: 'Marked as emergency leave for today' });
    expect(done.body.data.status).toBe('RESOLVED');
    expect(done.body.data.notes[0].text).toBe('Marked as emergency leave for today');
    expect((await as(hr.token).get('/api/v1/emergencies/active')).body.data).toHaveLength(0);

    // The employee sees their own history; the list for others is scoped to themselves.
    expect((await as(emp.token).get(`/api/v1/emergencies/${id}`)).status).toBe(200);
    expect((await as(other.token).get('/api/v1/emergencies')).body.data).toHaveLength(0);
    // And can raise a new one now that the last is resolved.
    expect((await as(emp.token).post('/api/v1/emergencies', { category: 'HOME', needToLeave: false })).status).toBe(201);
  });
});
