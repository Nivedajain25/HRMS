import { describe, expect, it } from 'vitest';
import { NotificationModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg } from '../helpers';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const userOf = (u: { employee: { userId?: unknown } }) => String((u.employee.userId as { _id?: unknown } | null)?._id ?? u.employee.userId);

describe('HR is informed of employee requests', () => {
  it('notifies HR (in-app) about a new request even when the manager approves it', async () => {
    const admin = await registerOrg();
    const hr = await createEmployeeUser(admin.token, { firstName: 'Hana', roles: ['hr_manager'] });
    const boss = await createEmployeeUser(admin.token, { firstName: 'Boss', roles: ['manager'] });
    const emp = await createEmployeeUser(admin.token, { firstName: 'Eli', managerId: boss.employee._id });

    const sub = await as(emp.token).post('/api/v1/attendance/regularizations', {
      date: daysAgo(2),
      requestedCheckIn: '10:00',
      requestedCheckOut: '19:00',
      reason: 'Forgot to clock in',
    });
    expect(sub.status).toBe(201);
    expect(sub.body.data.currentApproverType).toBe('MANAGER');

    const about = await NotificationModel.find({ entityId: sub.body.data._id }).lean();
    const hrNotes = about.filter((n) => String(n.userId) === userOf(hr));
    const bossNotes = about.filter((n) => String(n.userId) === userOf(boss));
    // The manager gets the approval request; HR gets one FYI copy (not two); the employee gets nothing about their own request.
    expect(bossNotes).toHaveLength(1);
    expect(hrNotes).toHaveLength(1);
    expect(hrNotes[0]!.title).toContain('New regularization request');
    expect(about.some((n) => String(n.userId) === userOf(emp))).toBe(false);
  });
});
