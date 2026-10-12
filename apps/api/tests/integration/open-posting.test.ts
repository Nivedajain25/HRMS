import { beforeAll, describe, expect, it } from 'vitest';
import { NotificationModel, UserModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg } from '../helpers';

/** Anyone signed in can post announcements and assign tasks to anyone; only the author (or HR) can change them. */
describe('Announcements and tasks by anyone', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let alice: Awaited<ReturnType<typeof createEmployeeUser>>;
  let bob: Awaited<ReturnType<typeof createEmployeeUser>>;
  const userIdOf = async (e: { employee: { _id: string } }) => (await UserModel.findOne({ employeeId: e.employee._id }).lean())!._id;

  beforeAll(async () => {
    admin = await registerOrg();
    alice = await createEmployeeUser(admin.token, { roles: ['employee'], firstName: 'Alice' });
    bob = await createEmployeeUser(admin.token, { roles: ['employee'], firstName: 'Bob' });
  });

  it('lets an employee post an announcement; the audience is notified; only the author or HR can change it', async () => {
    const res = await as(alice.token).post('/api/v1/announcements', { title: 'Team lunch Friday', content: '<p>All welcome</p>' });
    expect(res.status).toBe(201);
    expect(res.body.data.canEdit).toBe(true);
    const id = res.body.data._id;

    // Bob sees it, is notified, and cannot change it.
    const seen = await as(bob.token).get(`/api/v1/announcements/${id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.canEdit).toBe(false);
    const notified = await NotificationModel.find({ userId: await userIdOf(bob), type: 'ANNOUNCEMENT' }).lean();
    expect(notified.map((n) => n.title)).toContain('Team lunch Friday');
    expect((await as(bob.token).patch(`/api/v1/announcements/${id}`, { title: 'Hijacked' })).status).toBe(403);
    expect((await as(bob.token).delete(`/api/v1/announcements/${id}`)).status).toBe(403);
    expect((await as(bob.token).get(`/api/v1/announcements/${id}/reads`)).status).toBe(403);

    // The author can edit and see read tracking; "scope=all" lists only their own.
    expect((await as(alice.token).patch(`/api/v1/announcements/${id}`, { title: 'Team lunch Saturday' })).status).toBe(200);
    expect((await as(alice.token).get(`/api/v1/announcements/${id}/reads`)).status).toBe(200);
    await as(admin.token).post('/api/v1/announcements', { title: 'HR notice', content: '<p>x</p>' });
    const mine = await as(alice.token).get('/api/v1/announcements?scope=all');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((a: { title: string }) => a.title)).toEqual(['Team lunch Saturday']);

    // HR can manage it too; the author can delete it.
    expect((await as(admin.token).patch(`/api/v1/announcements/${id}`, { pinned: true })).status).toBe(200);
    expect((await as(alice.token).delete(`/api/v1/announcements/${id}`)).status).toBe(200);
  });

  it('lets an employee attach a file to an announcement', async () => {
    const res = await as(alice.token).upload('/api/v1/files').field('context', 'ANNOUNCEMENT').attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'note.pdf');
    expect(res.status).toBe(201);
  });

  it('lets an employee assign a task to anyone, and the assignee is notified', async () => {
    const people = await as(alice.token).get('/api/v1/tasks/assignable');
    expect(people.status).toBe(200);
    const ids = people.body.data.map((p: { _id: string }) => p._id);
    expect(ids).toContain(bob.employee._id);
    // The caller is listed first (flagged) so they can give themselves a task.
    expect(people.body.data[0]).toMatchObject({ _id: alice.employee._id, isSelf: true });

    const res = await as(alice.token).post('/api/v1/tasks', { title: 'Send the stock report', assigneeIds: [bob.employee._id] });
    expect(res.status).toBe(201);
    const unseen = await as(bob.token).get('/api/v1/tasks/unseen');
    expect(unseen.body.data.map((t: { title: string }) => t.title)).toContain('Send the stock report');
    const notified = await NotificationModel.find({ userId: await userIdOf(bob), type: 'TASK' }).lean();
    expect(notified.some((n) => n.title.includes('Send the stock report'))).toBe(true);
  });

  it('lets an employee assign a task to themselves: it is in their list, with no pop-up or notification', async () => {
    const res = await as(alice.token).post('/api/v1/tasks', { title: 'Call the vendor', assigneeIds: [alice.employee._id], priority: 'HIGH' });
    expect(res.status).toBe(201);
    const mine = await as(alice.token).get('/api/v1/tasks?scope=mine&state=open');
    expect(mine.body.data.map((t: { title: string }) => t.title)).toContain('Call the vendor');
    const unseen = await as(alice.token).get('/api/v1/tasks/unseen');
    expect(unseen.body.data.map((t: { title: string }) => t.title)).not.toContain('Call the vendor');
    const notified = await NotificationModel.find({ userId: await userIdOf(alice), type: 'TASK' }).lean();
    expect(notified.some((n) => n.title.includes('Call the vendor'))).toBe(false);
    // ...and they can move it along themselves.
    const done = await as(alice.token).patch(`/api/v1/tasks/${res.body.data[0]._id}/status`, { status: 'DONE' });
    expect(done.status).toBe(200);
  });
});
