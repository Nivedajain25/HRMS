import { Types } from 'mongoose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EmailLogModel, EmployeeModel, LeaveRequestModel, NotificationDispatchModel, NotificationModel, UserModel } from '../../src/models';
import { sentEmails, setEmailTransport } from '../../src/services/email.service';
import { as, createEmployeeUser, registerOrg, uniqueEmail } from '../helpers';

/**
 * Automated notifications: leave (manager / HR in CC / admin / employee, escalation past a manager on leave) and
 * interviews (interviewers, recruiters, candidate), the rules HR configures, the notification log, retries and
 * access control.
 */

const Y = new Date().getUTCFullYear() + 1;
const day = (n: number) => {
  const d = new Date(Date.UTC(Y, 0, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Emp = Awaited<ReturnType<typeof createEmployeeUser>>;
const emailsFor = (subjectPart: string) => sentEmails.filter((e) => e.subject.includes(subjectPart));
const dispatchesFor = (entityId: string) => NotificationDispatchModel.find({ entityId: new Types.ObjectId(entityId) }).sort({ createdAt: 1 }).lean();
const inbox = async (email: string) => {
  const user = await UserModel.findOne({ email }).select('_id').lean();
  return NotificationModel.find({ userId: user!._id }).sort({ createdAt: -1 }).lean();
};

afterEach(() => setEmailTransport(null));

describe('Automated notifications', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let hr: Emp;
  let head: Emp;
  let mgr: Emp;
  let emp: Emp;
  let types: Record<string, string>;

  beforeAll(async () => {
    admin = await registerOrg();
    hr = await createEmployeeUser(admin.token, { firstName: 'Hema', roles: ['hr_manager'] });
    head = await createEmployeeUser(admin.token, { firstName: 'Harish', roles: ['manager'] });
    mgr = await createEmployeeUser(admin.token, { firstName: 'Meera', roles: ['manager'], managerId: head.employee._id });
    emp = await createEmployeeUser(admin.token, { firstName: 'Esha', managerId: mgr.employee._id });
    const res = await as(admin.token).get('/api/v1/leave-types/all');
    types = Object.fromEntries((res.body.data as { code: string; _id: string }[]).map((t) => [t.code, t._id]));
  });

  it('leave requested: manager and admin get it (in-app + email), HR in CC, all logged', async () => {
    sentEmails.length = 0;
    const res = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(7), endDate: day(8), reason: 'Family function' });
    expect(res.status).toBe(201);
    const [log] = await dispatchesFor(res.body.data._id);
    expect(log).toMatchObject({ event: 'LEAVE_SUBMITTED', outcome: 'SENT' });
    const byRole = Object.fromEntries(log!.recipients.map((r) => [r.email, r]));
    expect(byRole[mgr.email]).toMatchObject({ role: 'MANAGER', inApp: true, emailAs: 'TO' });
    expect(byRole[admin.email]).toMatchObject({ role: 'ADMIN', inApp: true, emailAs: 'TO' });
    expect(byRole[hr.email]).toMatchObject({ role: 'HR', inApp: true, emailAs: 'CC' });
    // The requester did it themselves: not notified, but recorded.
    expect(log!.recipients.some((r) => r.email === emp.email)).toBe(false);

    const [mail] = emailsFor('Leave request:');
    expect(mail!.to.split(', ').sort()).toEqual([admin.email, mgr.email].sort());
    expect(mail!.cc).toEqual([hr.email]);
    expect(mail!.text).toContain('Family function');
    expect((await inbox(mgr.email))[0]).toMatchObject({ type: 'LEAVE_SUBMITTED', readAt: null });
    expect((await EmailLogModel.findById(log!.emailLogIds[0]).lean())?.status).toMatch(/SENT|SKIPPED/);
  });

  it('manager on leave today: the next manager up gets it instead, recorded as an escalation', async () => {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    await LeaveRequestModel.create({
      organizationId: new Types.ObjectId(admin.user.organization._id),
      employeeId: mgr.employee._id,
      leaveTypeId: types.CL,
      startDate: today,
      endDate: today,
      days: 1,
      reason: 'Away',
      status: 'APPROVED',
    });
    sentEmails.length = 0;
    const res = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(14), endDate: day(14), reason: 'Doctor visit' });
    expect(res.status).toBe(201);
    const [log] = await dispatchesFor(res.body.data._id);
    expect(log!.escalations).toHaveLength(1);
    expect(log!.escalations[0]).toMatchObject({ fromName: 'Meera Person', toName: 'Harish Person', reason: 'is on leave today' });
    const recipients = Object.fromEntries(log!.recipients.map((r) => [r.email, r]));
    expect(recipients[head.email]).toMatchObject({ role: 'MANAGER', emailAs: 'TO' });
    expect(recipients[mgr.email]).toBeUndefined();
    const [mail] = emailsFor('Leave request:');
    expect(mail!.to).toContain(head.email);
    expect(mail!.cc).toEqual([hr.email]); // HR stays in CC on escalated mail
    expect(mail!.text).toContain('Escalated: Meera Person is on leave today');
    // The skip-level manager can act on it.
    expect((await as(head.token).post(`/api/v1/leaves/${res.body.data._id}/approve`, {})).status).toBe(200);
    await LeaveRequestModel.deleteMany({ employeeId: mgr.employee._id, reason: 'Away' });
  });

  it('final approval: the employee gets their own email, the team gets one with HR in CC', async () => {
    const created = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(21), endDate: day(21), reason: 'Errand' });
    sentEmails.length = 0;
    expect((await as(mgr.token).post(`/api/v1/leaves/${created.body.data._id}/approve`, { comment: 'Enjoy' })).status).toBe(200);
    const logs = await dispatchesFor(created.body.data._id);
    const approved = logs.find((l) => l.event === 'LEAVE_APPROVED')!;
    expect(approved.recipients.find((r) => r.email === emp.email)).toMatchObject({ role: 'EMPLOYEE', inApp: true, emailAs: 'TO' });
    expect(approved.recipients.find((r) => r.email === mgr.email)).toMatchObject({ skipped: 'performed the action' });
    const self = sentEmails.find((e) => e.to === emp.email)!;
    expect(self.subject).toBe('Your leave was approved');
    expect(self.text).toContain('Comment: Enjoy');
    expect(self.cc).toEqual([]); // HR is copied once, on the team email
    const team = sentEmails.find((e) => e.subject.startsWith('Leave approved:'))!;
    expect(team.cc).toEqual([hr.email]);
    expect((await inbox(emp.email))[0]).toMatchObject({ type: 'LEAVE_APPROVED', title: 'Your leave was approved' });
  });

  it('cancelling a pending request and editing one both notify the team', async () => {
    const created = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(28), endDate: day(28), reason: 'Plans' });
    const id = created.body.data._id;
    expect((await as(emp.token).patch(`/api/v1/leaves/${id}`, { endDate: day(29) })).status).toBe(200);
    expect((await as(emp.token).post(`/api/v1/leaves/${id}/cancel`, { reason: 'Plans changed' })).status).toBe(200);
    const events = (await dispatchesFor(id)).map((l) => l.event);
    expect(events).toEqual(['LEAVE_SUBMITTED', 'LEAVE_MODIFIED', 'LEAVE_CANCELLED']);
    const modified = (await dispatchesFor(id)).find((l) => l.event === 'LEAVE_MODIFIED')!;
    expect(modified.recipients.map((r) => r.role).sort()).toEqual(['ADMIN', 'HR', 'MANAGER']);
    expect((await inbox(mgr.email)).some((n) => n.type === 'LEAVE_CANCELLED')).toBe(true);
  });

  it('HR configures the rules: switch an event off, change recipients and CC, edit templates (escaped)', async () => {
    // Only settings:manage may read or change the rules; only audit:read may see the log.
    expect((await as(emp.token).get('/api/v1/notification-settings')).status).toBe(403);
    expect((await as(mgr.token).put('/api/v1/notification-settings', { rules: { LEAVE_SUBMITTED: { enabled: false } } })).status).toBe(403);
    expect((await as(emp.token).get('/api/v1/notification-log')).status).toBe(403);

    const settings = await as(admin.token).get('/api/v1/notification-settings');
    expect(settings.status).toBe(200);
    expect(settings.body.data.events.map((e: { event: string }) => e.event)).toContain('INTERVIEW_RESULT');
    expect(settings.body.data.rules.LEAVE_SUBMITTED.ccHr).toBe(true);
    // A recipient that doesn't apply to leave is refused.
    expect((await as(admin.token).put('/api/v1/notification-settings', { rules: { LEAVE_SUBMITTED: { recipients: ['CANDIDATE'] } } })).status).toBe(400);

    const saved = await as(admin.token).put('/api/v1/notification-settings', {
      rules: {
        LEAVE_SUBMITTED: { recipients: ['MANAGER'], ccHr: false, subject: '<b>Leave</b> for {{employeeName}}' },
        LEAVE_CANCELLED: { enabled: false },
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.customized.sort()).toEqual(['LEAVE_CANCELLED', 'LEAVE_SUBMITTED']);

    sentEmails.length = 0;
    const created = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(35), endDate: day(35), reason: 'Rest' });
    const [mail] = sentEmails;
    expect(mail!.to).toBe(mgr.email);
    expect(mail!.cc).toEqual([]);
    expect(mail!.subject).toBe('<b>Leave</b> for Esha Person');
    const html = (await EmailLogModel.findById((await dispatchesFor(created.body.data._id))[0]!.emailLogIds[0]).select('+rendered').lean())!.rendered!.html!;
    expect(html).toContain('&lt;b&gt;Leave&lt;/b&gt;');
    expect(html).not.toContain('<b>Leave</b>');

    await as(emp.token).post(`/api/v1/leaves/${created.body.data._id}/cancel`, {});
    const cancelled = (await dispatchesFor(created.body.data._id)).find((l) => l.event === 'LEAVE_CANCELLED')!;
    expect(cancelled.outcome).toBe('DISABLED');

    // Preview renders sample data with unsaved edits; restoring defaults clears the overrides.
    const preview = await as(admin.token).post('/api/v1/notification-settings/preview', { event: 'LEAVE_APPROVED', audience: 'self', rule: { selfSubject: 'Hi {{employeeName}}' } });
    expect(preview.body.data.subject).toBe('Hi Ananya Sharma');
    const reset = await as(admin.token).put('/api/v1/notification-settings', { rules: { LEAVE_SUBMITTED: null, LEAVE_CANCELLED: null } });
    expect(reset.body.data.customized).toEqual([]);
  });

  it('interviews: interviewers, hiring manager and recruiters are told, the candidate is emailed; cancellation and results too', async () => {
    const recruiter = await createEmployeeUser(admin.token, { firstName: 'Rex', roles: ['recruiter'] });
    const interviewer = await createEmployeeUser(admin.token, { firstName: 'Ivan' });
    const dept = (await as(admin.token).post('/api/v1/departments', { name: 'Sales', code: 'SAL' })).body.data._id;
    const desig = (await as(admin.token).post('/api/v1/designations', { name: 'Exec', code: 'EXE', level: 1, departmentId: dept })).body.data._id;
    const job = (await as(recruiter.token).post('/api/v1/recruitment/jobs', { title: 'Sales Exec', description: 'Sell', departmentId: dept, designationId: desig, hiringManagerId: head.employee._id, openings: 1 })).body.data;
    await as(recruiter.token).post(`/api/v1/recruitment/jobs/${job._id}/status`, { status: 'OPEN' });
    const candidateEmail = uniqueEmail('cand');
    const cand = (await as(recruiter.token).post('/api/v1/recruitment/candidates', { jobId: job._id, firstName: 'Priya', lastName: 'Nair', email: candidateEmail, source: 'LINKEDIN' })).body.data;

    sentEmails.length = 0;
    const iv = await as(recruiter.token).post('/api/v1/recruitment/interviews', { candidateId: cand._id, interviewerIds: [interviewer.employee._id], date: `${Y}-03-10`, startTime: '10:00', meetingLink: 'https://meet.example.com/x' });
    expect(iv.status).toBe(201);
    const [scheduled] = await dispatchesFor(iv.body.data._id);
    const roles = Object.fromEntries(scheduled!.recipients.map((r) => [r.email, r.role]));
    expect(roles[interviewer.email]).toBe('INTERVIEWERS');
    expect(roles[head.email]).toBe('HIRING_MANAGER');
    expect(roles[candidateEmail]).toBe('CANDIDATE');
    expect(scheduled!.recipients.find((r) => r.email === recruiter.email)?.skipped).toBe('performed the action');
    const candMail = sentEmails.find((e) => e.to === candidateEmail)!;
    expect(candMail.subject).toContain('Your interview for Sales Exec');
    expect(candMail.text).toContain('https://meet.example.com/x');
    expect((await inbox(interviewer.email))[0]).toMatchObject({ type: 'INTERVIEW_SCHEDULED' });

    sentEmails.length = 0;
    expect((await as(recruiter.token).post(`/api/v1/recruitment/interviews/${iv.body.data._id}/status`, { status: 'CANCELLED', reason: 'Candidate asked to move it' })).status).toBe(200);
    expect(sentEmails.find((e) => e.to === candidateEmail)?.subject).toContain('was cancelled');
    expect((await inbox(interviewer.email))[0]).toMatchObject({ type: 'INTERVIEW_CANCELLED' });

    const iv2 = await as(recruiter.token).post('/api/v1/recruitment/interviews', { candidateId: cand._id, interviewerIds: [interviewer.employee._id], date: `${Y}-03-12`, startTime: '10:00' });
    expect((await as(interviewer.token).post(`/api/v1/recruitment/interviews/${iv2.body.data._id}/feedback`, { rating: 4, feedback: 'Strong', recommendation: 'HIRE' })).status).toBe(200);
    const result = (await dispatchesFor(iv2.body.data._id)).find((l) => l.event === 'INTERVIEW_RESULT')!;
    expect(result.title).toBe('Interview feedback: Priya Nair · Hire');
    expect(result.recipients.map((r) => r.role)).toEqual(expect.arrayContaining(['HIRING_MANAGER', 'RECRUITERS', 'HR']));
    expect(result.recipients.some((r) => r.role === 'CANDIDATE')).toBe(false); // results aren't sent to candidates by default
  });

  it('failed emails are retried, logged as failed after the last attempt, and can be re-sent from the log', async () => {
    let calls = 0;
    setEmailTransport({ sendMail: async () => { calls++; throw new Error('SMTP down'); } } as never);
    const created = await as(emp.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(42), endDate: day(42), reason: 'Retry test' });
    const [log] = await dispatchesFor(created.body.data._id);
    const email = await EmailLogModel.findById(log!.emailLogIds[0]).lean();
    expect(email).toMatchObject({ status: 'FAILED', attempts: 4, error: 'SMTP down' });
    expect(calls).toBe(4);

    const list = await as(admin.token).get('/api/v1/notification-log?status=FAILED');
    expect(list.status).toBe(200);
    expect(list.body.data.map((i: { _id: string }) => i._id)).toContain(String(log!._id));
    const detail = await as(admin.token).get(`/api/v1/notification-log/${log!._id}`);
    expect(detail.body.data.emails[0]).toMatchObject({ status: 'FAILED', attempts: 4 });

    setEmailTransport(null);
    // HR without settings:manage can read the log but not re-send.
    expect((await as(hr.token).post(`/api/v1/notification-log/emails/${email!._id}/retry`)).status).toBe(403);
    const retry = await as(admin.token).post(`/api/v1/notification-log/emails/${email!._id}/retry`);
    expect(retry.status).toBe(200);
    expect((await EmailLogModel.findById(email!._id).lean())?.status).toMatch(/SENT|SKIPPED/);
  });

  it('no reporting manager anywhere: HR is told directly and the log says so', async () => {
    const loner = await createEmployeeUser(admin.token, { firstName: 'Lone' });
    expect((await EmployeeModel.findById(loner.employee._id).lean())?.managerId ?? null).toBeNull();
    sentEmails.length = 0;
    const created = await as(loner.token).post('/api/v1/leaves', { leaveTypeId: types.CL, startDate: day(49), endDate: day(49), reason: 'Solo' });
    const [log] = await dispatchesFor(created.body.data._id);
    // With no manager the approval goes to HR, so HR is listed as the approver (once) and told in-app + by email.
    expect(log!.recipients.filter((r) => r.email === hr.email)).toHaveLength(1);
    expect(log!.recipients.find((r) => r.email === hr.email)).toMatchObject({ role: expect.stringMatching(/APPROVER|HR/), inApp: true });
    expect(sentEmails.some((e) => e.to.includes(hr.email) || e.cc.includes(hr.email))).toBe(true);
    expect(log!.error).toContain('no reporting manager');
  });
});
