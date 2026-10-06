import { Types } from 'mongoose';
import { beforeAll, describe, expect, it } from 'vitest';
import { EmployeeModel, HolidayModel, LocationModel, PayrollModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg } from '../helpers';

/** Regression tests for issues found during UI review. */
describe('Review follow-ups', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let orgId: Types.ObjectId;

  beforeAll(async () => {
    admin = await registerOrg();
    orgId = new Types.ObjectId(admin.user.organization._id as string);
  });

  it('leave calendar labels location-specific holidays for org-wide viewers', async () => {
    const [mumbai, pune] = await LocationModel.create([
      { organizationId: orgId, name: 'Mumbai' },
      { organizationId: orgId, name: 'Pune' },
    ]);
    const emp = await createEmployeeUser(admin.token, { firstName: 'Loc' });
    await EmployeeModel.updateOne({ _id: emp.employee._id }, { locationId: mumbai!._id });
    await HolidayModel.create([
      { organizationId: orgId, name: 'Founders Day', date: new Date('2031-03-03T00:00:00Z'), type: 'COMPANY' },
      { organizationId: orgId, name: 'Mumbai Festival', date: new Date('2031-03-05T00:00:00Z'), type: 'REGIONAL', locationIds: [mumbai!._id] },
      { organizationId: orgId, name: 'Pune Festival', date: new Date('2031-03-06T00:00:00Z'), type: 'REGIONAL', locationIds: [pune!._id] },
    ]);

    // HR/admin (org-wide) sees org-wide + Mumbai (an employee is there), not Pune (nobody there).
    const res = await as(admin.token).get('/api/v1/leaves/calendar?from=2031-03-01&to=2031-03-31');
    expect(res.status).toBe(200);
    const byName = new Map(res.body.data.holidays.map((h: { name: string; locations: string[] }) => [h.name, h.locations]));
    expect(byName.get('Founders Day')).toEqual([]);
    expect(byName.get('Mumbai Festival')).toEqual(['Mumbai']);
    expect(byName.has('Pune Festival')).toBe(false);

    // The Mumbai employee sees their regional holiday too.
    const own = await as(emp.token).get('/api/v1/leaves/calendar?from=2031-03-01&to=2031-03-31');
    expect(own.body.data.holidays.map((h: { name: string }) => h.name)).toEqual(expect.arrayContaining(['Founders Day', 'Mumbai Festival']));
  });

  it('payroll summary never sums different currencies', async () => {
    const base = { organizationId: orgId, year: 2031, status: 'PAID', periodStart: new Date('2031-01-01'), periodEnd: new Date('2031-01-31') };
    await PayrollModel.create([
      { ...base, month: 1, currency: 'USD', totalNet: 1000, totalGross: 1200, periodKey: '2031-01' },
      { ...base, month: 2, currency: 'EUR', totalNet: 500, totalGross: 600, periodKey: '2031-02' },
    ]);
    const res = await as(admin.token).get('/api/v1/payroll/summary?year=2031');
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe('USD');
    expect(res.body.data.totals.totalNet).toBe(1000);
    expect(res.body.data.otherCurrencies).toEqual([{ currency: 'EUR', runs: 1, totalGross: 600, totalNet: 500 }]);
  });

  it('announcement read tracking flags readers outside the audience', async () => {
    const dept = await as(admin.token).post('/api/v1/departments', { name: 'Comms', code: 'COM' });
    const member = await createEmployeeUser(admin.token, { firstName: 'Member', departmentId: dept.body.data._id });
    const created = await as(admin.token).post('/api/v1/announcements', {
      title: 'Dept only',
      content: '<p>Hello team</p>',
      audience: 'DEPARTMENTS',
      departmentIds: [dept.body.data._id],
    });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    await as(member.token).post(`/api/v1/announcements/${id}/read`);
    await as(admin.token).post(`/api/v1/announcements/${id}/read`); // admin is outside the audience

    const reads = await as(admin.token).get(`/api/v1/announcements/${id}/reads`);
    expect(reads.body.data.read).toBe(1);
    expect(reads.body.data.total).toBe(1);
    expect(reads.body.data.outsideAudience).toBe(1);
    expect(reads.body.data.readers.map((r: { inAudience: boolean }) => r.inAudience).sort()).toEqual([false, true]);

    // Managers get audience names on the detail endpoint.
    const detail = await as(admin.token).get(`/api/v1/announcements/${id}`);
    expect(detail.body.data.audienceTargets.departments[0].name).toBe('Comms');
  });
});
