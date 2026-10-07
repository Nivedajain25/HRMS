import { beforeAll, describe, expect, it } from 'vitest';
import { CandidateModel, EmployeeModel, JobOpeningModel, OnboardingModel, UserModel } from '../../src/models';
import { sentEmails } from '../../src/services/email.service';
import { as, createEmployeeUser, registerOrg, uniqueEmail } from '../helpers';

type Emp = Awaited<ReturnType<typeof createEmployeeUser>>;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

describe('Recruitment: jobs, pipeline, interviews, hiring', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let recruiter: Emp;
  let employee: Emp;
  let interviewerA: Emp;
  let interviewerB: Emp;
  let deptId: string;
  let designationId: string;
  let jobId: string;
  let candidateId: string;
  let candidateEmail: string;
  let interviewId: string;
  let secondInterviewId: string;

  const addCandidate = async (token: string, overrides: Record<string, unknown> = {}) =>
    as(token).post('/api/v1/recruitment/candidates', {
      jobId,
      firstName: 'Cand',
      lastName: 'Idate',
      email: uniqueEmail('cand'),
      phone: '+1 555 0199',
      skills: ['TypeScript', 'MongoDB'],
      source: 'LINKEDIN',
      ...overrides,
    });

  const stage = (token: string, id: string, body: Record<string, unknown>) => as(token).post(`/api/v1/recruitment/candidates/${id}/stage`, body);

  beforeAll(async () => {
    admin = await registerOrg();
    recruiter = await createEmployeeUser(admin.token, { firstName: 'Rex', roles: ['recruiter'] });
    employee = await createEmployeeUser(admin.token, { firstName: 'Eve' });
    interviewerA = await createEmployeeUser(admin.token, { firstName: 'Ivan', roles: ['manager'] });
    interviewerB = await createEmployeeUser(admin.token, { firstName: 'Ines' });
    deptId = (await as(admin.token).post('/api/v1/departments', { name: 'Engineering', code: 'ENG' })).body.data._id;
    designationId = (await as(admin.token).post('/api/v1/designations', { name: 'Engineer', code: 'ENGR', level: 2, departmentId: deptId })).body.data._id;
  });

  it('enforces job permissions and generates job codes', async () => {
    const body = { title: 'Backend Engineer', description: 'Build APIs', departmentId: deptId, designationId, hiringManagerId: interviewerA.employee._id, openings: 1 };
    expect((await as(employee.token).post('/api/v1/recruitment/jobs', body)).status).toBe(403);
    expect((await as(employee.token).get('/api/v1/recruitment/jobs')).status).toBe(403);

    const created = await as(recruiter.token).post('/api/v1/recruitment/jobs', body);
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('JOB-0001');
    expect(created.body.data.status).toBe('DRAFT');
    jobId = created.body.data._id;

    const bad = await as(recruiter.token).post('/api/v1/recruitment/jobs', { ...body, salaryMin: 100, salaryMax: 50 });
    expect(bad.status).toBe(400);

    // PATCH without status must not reset it; status changes go through /status.
    const upd = await as(recruiter.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { requirements: '5y Node' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('DRAFT');
    expect(upd.body.data.openings).toBe(1);

    // Candidates only for open jobs.
    expect((await addCandidate(recruiter.token)).status).toBe(422);

    const open = await as(recruiter.token).post(`/api/v1/recruitment/jobs/${jobId}/status`, { status: 'OPEN' });
    expect(open.status).toBe(200);
    expect(open.body.data.publishedAt).toBeTruthy();
    expect((await as(recruiter.token).post(`/api/v1/recruitment/jobs/${jobId}/status`, { status: 'DRAFT' })).status).toBe(422);

    // Hiring manager (no recruitment:read) sees only the jobs they manage.
    const hm = await as(interviewerA.token).get('/api/v1/recruitment/jobs');
    expect(hm.status).toBe(200);
    expect(hm.body.data.map((j: { _id: string }) => j._id)).toEqual([jobId]);
  });

  it('adds candidates with duplicate protection and lists them with counts', async () => {
    candidateEmail = uniqueEmail('star');
    const c = await addCandidate(recruiter.token, { firstName: 'Stella', lastName: 'Star', email: candidateEmail });
    expect(c.status).toBe(201);
    expect(c.body.data.stage).toBe('APPLIED');
    candidateId = c.body.data._id;
    const dup = await addCandidate(recruiter.token, { email: candidateEmail.toUpperCase() });
    expect(dup.status).toBe(409);
    expect((await addCandidate(employee.token)).status).toBe(403);

    const list = await as(recruiter.token).get(`/api/v1/recruitment/candidates?jobId=${jobId}&search=mongo`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((x: { _id: string }) => x._id === candidateId)).toBe(true);
    const jobs = await as(recruiter.token).get('/api/v1/recruitment/jobs');
    expect(jobs.body.data[0].candidateCounts.APPLIED).toBe(1);
  });

  it('validates pipeline transitions', async () => {
    const skip = await stage(recruiter.token, candidateId, { stage: 'HIRED' });
    expect(skip.status).toBe(422);
    expect(skip.body.code).toBe('INVALID_TRANSITION');
    expect((await stage(recruiter.token, candidateId, { stage: 'SHORTLISTED' })).status).toBe(422);
    expect((await stage(employee.token, candidateId, { stage: 'SCREENING' })).status).toBe(403);
    expect((await stage(recruiter.token, candidateId, { stage: 'SCREENING' })).status).toBe(200);
    const sl = await stage(recruiter.token, candidateId, { stage: 'SHORTLISTED', note: 'Strong CV' });
    expect(sl.status).toBe(200);
    expect(sl.body.data.stageHistory.map((h: { to: string }) => h.to)).toEqual(['APPLIED', 'SCREENING', 'SHORTLISTED']);

    const loser = (await addCandidate(recruiter.token)).body.data._id;
    expect((await stage(recruiter.token, loser, { stage: 'REJECTED' })).status).toBe(400);
    const rej = await stage(recruiter.token, loser, { stage: 'REJECTED', rejectionReason: 'Not a fit' });
    expect(rej.status).toBe(200);
    expect(rej.body.data.rejectionReason).toBe('Not a fit');
    expect((await stage(recruiter.token, loser, { stage: 'HIRED' })).status).toBe(422);
    const hireRejected = await as(admin.token).post(`/api/v1/recruitment/candidates/${loser}/hire`, { joiningDate: '2030-02-01', workEmail: uniqueEmail('x') });
    expect(hireRejected.status).toBe(422);
    // Interviews cannot be scheduled for rejected candidates.
    const iv = await as(recruiter.token).post('/api/v1/recruitment/interviews', {
      candidateId: loser,
      interviewerIds: [interviewerB.employee._id],
      date: '2030-01-10',
      startTime: '09:00',
    });
    expect(iv.status).toBe(422);

    const board = await as(recruiter.token).get(`/api/v1/recruitment/pipeline?jobId=${jobId}`);
    expect(board.status).toBe(200);
    const byStage = Object.fromEntries(board.body.data.stages.map((s: { stage: string; count: number }) => [s.stage, s.count]));
    expect(byStage.SHORTLISTED).toBe(1);
    expect(byStage.REJECTED).toBe(1);
  });

  it('schedules interviews, prevents double booking and averages feedback', async () => {
    const res = await as(recruiter.token).post('/api/v1/recruitment/interviews', {
      candidateId,
      interviewerIds: [interviewerA.employee._id, interviewerB.employee._id],
      date: '2030-01-15',
      startTime: '10:00',
      durationMinutes: 60,
      type: 'VIDEO',
      meetingLink: 'https://meet.example.test/abc',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.scheduledAt).toBe('2030-01-15T10:00:00.000Z'); // org timezone is UTC
    interviewId = res.body.data._id;
    expect((await CandidateModel.findById(candidateId).lean())?.stage).toBe('INTERVIEW');
    expect(sentEmails.some((e) => e.to === candidateEmail && e.template === 'interview')).toBe(true);

    const other = (await addCandidate(recruiter.token)).body.data._id;
    const clash = await as(recruiter.token).post('/api/v1/recruitment/interviews', {
      candidateId: other,
      interviewerIds: [interviewerA.employee._id],
      date: '2030-01-15',
      startTime: '10:30',
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('INTERVIEWER_CONFLICT');
    const adjacent = await as(recruiter.token).post('/api/v1/recruitment/interviews', {
      candidateId: other,
      interviewerIds: [interviewerA.employee._id],
      date: '2030-01-15',
      startTime: '11:00',
    });
    expect(adjacent.status).toBe(201);
    secondInterviewId = adjacent.body.data._id;

    // Rescheduling into a clash is refused; a free slot increments the counter.
    expect((await as(recruiter.token).patch(`/api/v1/recruitment/interviews/${secondInterviewId}`, { startTime: '10:15' })).status).toBe(409);
    const moved = await as(recruiter.token).patch(`/api/v1/recruitment/interviews/${secondInterviewId}`, { date: '2030-01-16', startTime: '14:00' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.rescheduleCount).toBe(1);
    expect(moved.body.data.status).toBe('SCHEDULED');

    // Interviewers without recruitment:read see only their interviews.
    const mine = await as(interviewerB.token).get('/api/v1/recruitment/interviews?interviewerId=me');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((i: { _id: string }) => i._id)).toEqual([interviewId]);
    expect((await as(employee.token).get('/api/v1/recruitment/interviews')).body.data).toHaveLength(0);
    expect((await as(employee.token).get(`/api/v1/recruitment/interviews/${interviewId}`)).status).toBe(404);

    // Feedback: assigned interviewers only, one each, average rating.
    const fb = { rating: 4, feedback: 'Good system design', recommendation: 'HIRE' };
    expect((await as(employee.token).post(`/api/v1/recruitment/interviews/${interviewId}/feedback`, fb)).status).toBe(403);
    expect((await as(interviewerA.token).post(`/api/v1/recruitment/interviews/${interviewId}/feedback`, fb)).status).toBe(200);
    expect((await as(interviewerA.token).post(`/api/v1/recruitment/interviews/${interviewId}/feedback`, fb)).status).toBe(409);
    const second = await as(interviewerB.token).post(`/api/v1/recruitment/interviews/${interviewId}/feedback`, { ...fb, rating: 5, recommendation: 'STRONG_HIRE' });
    expect(second.status).toBe(200);
    expect(second.body.data.rating).toBe(4.5);
    expect(second.body.data.status).toBe('COMPLETED');
    expect(second.body.data.feedback).toHaveLength(2);
    expect((await CandidateModel.findById(candidateId).lean())?.rating).toBe(4.5);

    // Completed interviews can't be rescheduled; cancellation needs a reason.
    expect((await as(recruiter.token).patch(`/api/v1/recruitment/interviews/${interviewId}`, { startTime: '12:00' })).status).toBe(422);
    expect((await as(recruiter.token).post(`/api/v1/recruitment/interviews/${secondInterviewId}/status`, { status: 'CANCELLED' })).status).toBe(400);
    const cancelled = await as(recruiter.token).post(`/api/v1/recruitment/interviews/${secondInterviewId}/status`, { status: 'CANCELLED', reason: 'Candidate withdrew' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.cancellationReason).toBe('Candidate withdrew');

    const detail = await as(recruiter.token).get(`/api/v1/recruitment/candidates/${candidateId}`);
    expect(detail.body.data.interviews).toHaveLength(1);
    expect(detail.body.data.stageHistory.length).toBeGreaterThanOrEqual(4);
  });

  it('lets the hiring manager and assigned interviewers open a candidate resume', async () => {
    const up = await as(recruiter.token).upload('/api/v1/files').field('context', 'RESUME').attach('file', PDF, 'cv.pdf');
    expect(up.status).toBe(201);
    const resumeId = up.body.data._id as string;
    const cand = await addCandidate(recruiter.token, { firstName: 'Rhea', resumeFileId: resumeId });
    expect(cand.status).toBe(201);

    // interviewerA is the job's hiring manager (no recruitment:read).
    expect((await as(interviewerA.token).get(`/api/v1/files/${resumeId}`)).status).toBe(200);
    // Not yet an interviewer / unrelated employees are refused.
    expect((await as(interviewerB.token).get(`/api/v1/files/${resumeId}`)).status).toBe(403);
    expect((await as(employee.token).get(`/api/v1/files/${resumeId}`)).status).toBe(403);

    const iv = await as(recruiter.token).post('/api/v1/recruitment/interviews', {
      candidateId: cand.body.data._id,
      interviewerIds: [interviewerB.employee._id],
      date: '2030-03-05',
      startTime: '09:00',
    });
    expect(iv.status).toBe(201);
    expect((await as(interviewerB.token).get(`/api/v1/files/${resumeId}`)).status).toBe(200);
    expect((await as(employee.token).get(`/api/v1/files/${resumeId}`)).status).toBe(403);
    // Other tenants never see it.
    const other = await registerOrg();
    expect((await as(other.token).get(`/api/v1/files/${resumeId}`)).status).toBe(404);
  });

  it('clears job closing date and interview meeting link / location / notes via PATCH', async () => {
    const set = await as(recruiter.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { closingDate: '2030-12-31' });
    expect(set.status).toBe(200);
    expect(set.body.data.closingDate).toBe('2030-12-31T00:00:00.000Z');
    const cleared = await as(recruiter.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { closingDate: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.closingDate ?? null).toBeNull();
    expect((await JobOpeningModel.findById(jobId).lean())?.closingDate ?? null).toBeNull();
    await as(recruiter.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { closingDate: '2030-12-31' });
    expect((await as(recruiter.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { closingDate: '' })).body.data.closingDate ?? null).toBeNull();
    // Required fields cannot be cleared.
    expect((await as(recruiter.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { title: null })).status).toBe(400);

    const cand = await addCandidate(recruiter.token, { firstName: 'Lina' });
    const iv = await as(recruiter.token).post('/api/v1/recruitment/interviews', {
      candidateId: cand.body.data._id,
      interviewerIds: [interviewerB.employee._id],
      date: '2030-03-06',
      startTime: '09:00',
      meetingLink: 'https://meet.example.test/xyz',
      location: 'Room 4',
      notes: 'Bring laptop',
    });
    expect(iv.status).toBe(201);
    const id = iv.body.data._id as string;
    const upd = await as(recruiter.token).patch(`/api/v1/recruitment/interviews/${id}`, { meetingLink: '', location: null, notes: '' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.meetingLink ?? null).toBeNull();
    expect(upd.body.data.location ?? null).toBeNull();
    expect(upd.body.data.notes ?? null).toBeNull();
    // Omitted fields stay unchanged.
    const again = await as(recruiter.token).patch(`/api/v1/recruitment/interviews/${id}`, { meetingLink: 'https://meet.example.test/new' });
    expect(again.body.data.meetingLink).toBe('https://meet.example.test/new');
    const keep = await as(recruiter.token).patch(`/api/v1/recruitment/interviews/${id}`, { durationMinutes: 45 });
    expect(keep.body.data.meetingLink).toBe('https://meet.example.test/new');
    await as(recruiter.token).post(`/api/v1/recruitment/interviews/${id}/status`, { status: 'CANCELLED', reason: 'Test cleanup' });
  });

  it('hires an offered candidate into an employee with user and onboarding', async () => {
    expect((await stage(recruiter.token, candidateId, { stage: 'SELECTED' })).status).toBe(200);
    // SELECTED must go through OFFERED.
    const early = await as(admin.token).post(`/api/v1/recruitment/candidates/${candidateId}/hire`, { joiningDate: '2030-02-01', workEmail: uniqueEmail('early') });
    expect(early.status).toBe(422);
    expect((await stage(recruiter.token, candidateId, { stage: 'OFFERED' })).status).toBe(200);

    // Recruiters lack employee:create.
    expect((await as(recruiter.token).post(`/api/v1/recruitment/candidates/${candidateId}/hire`, { joiningDate: '2030-02-01', workEmail: uniqueEmail('r') })).status).toBe(403);

    const prefill = await as(admin.token).get(`/api/v1/recruitment/candidates/${candidateId}/hire-prefill`);
    expect(prefill.status).toBe(200);
    expect(prefill.body.data).toMatchObject({ firstName: 'Stella', lastName: 'Star', personalEmail: candidateEmail, departmentId: deptId, designationId, canHire: true });

    const workEmail = uniqueEmail('stella.work');
    const hire = await as(admin.token).post(`/api/v1/recruitment/candidates/${candidateId}/hire`, { joiningDate: '2030-02-01', workEmail });
    expect(hire.status).toBe(201);
    const empId = hire.body.data.employee._id;
    expect(hire.body.data.employee.departmentId._id).toBe(deptId);
    expect(hire.body.data.employee.managerId._id).toBe(interviewerA.employee._id);
    expect(hire.body.data.onboardingId).toBeTruthy();

    const emp = await EmployeeModel.findById(empId).lean();
    expect(emp?.personalEmail).toBe(candidateEmail);
    expect(emp?.firstName).toBe('Stella');
    expect(await UserModel.exists({ email: workEmail, employeeId: empId })).toBeTruthy();
    const onboarding = await OnboardingModel.findOne({ employeeId: empId }).lean();
    expect(String(onboarding?.candidateId)).toBe(candidateId);
    expect(String(onboarding?._id)).toBe(hire.body.data.onboardingId);

    const cand = await CandidateModel.findById(candidateId).lean();
    expect(cand?.stage).toBe('HIRED');
    expect(String(cand?.hiredEmployeeId)).toBe(empId);
    expect(cand?.hiredAt).toBeTruthy();
    const job = await JobOpeningModel.findById(jobId).lean();
    expect(job?.filled).toBe(1);
    expect(job?.status).toBe('CLOSED');

    // Cannot hire twice.
    expect((await as(admin.token).post(`/api/v1/recruitment/candidates/${candidateId}/hire`, { joiningDate: '2030-02-01', workEmail: uniqueEmail('again') })).status).toBe(422);

    const summary = await as(recruiter.token).get('/api/v1/recruitment/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.data.hires).toBe(1);
    expect(summary.body.data.candidatesByStage.HIRED).toBe(1);
    expect(summary.body.data.timeToHireAvgDays).not.toBeNull();
    expect((await as(employee.token).get('/api/v1/recruitment/summary')).status).toBe(403);
  });

  it('deletes empty jobs and closes jobs with candidates', async () => {
    const empty = await as(recruiter.token).post('/api/v1/recruitment/jobs', { title: 'Temp', description: 'Short lived' });
    const del = await as(recruiter.token).delete(`/api/v1/recruitment/jobs/${empty.body.data._id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    expect((await as(recruiter.token).get(`/api/v1/recruitment/jobs/${empty.body.data._id}`)).status).toBe(404);

    const withCands = await as(recruiter.token).delete(`/api/v1/recruitment/jobs/${jobId}`);
    expect(withCands.body.data).toEqual({ deleted: false, closed: true });
  });

  it('isolates tenants', async () => {
    const other = await registerOrg();
    expect((await as(other.token).get(`/api/v1/recruitment/jobs/${jobId}`)).status).toBe(404);
    expect((await as(other.token).patch(`/api/v1/recruitment/jobs/${jobId}`, { title: 'Hacked' })).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/recruitment/candidates/${candidateId}`)).status).toBe(404);
    expect((await as(other.token).post(`/api/v1/recruitment/candidates/${candidateId}/stage`, { stage: 'REJECTED', rejectionReason: 'x' })).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/recruitment/interviews/${interviewId}`)).status).toBe(404);
    expect((await as(other.token).post('/api/v1/recruitment/candidates', { jobId, firstName: 'A', lastName: 'B', email: uniqueEmail('t') })).status).toBe(400);
    expect((await as(other.token).get('/api/v1/recruitment/candidates')).body.data).toHaveLength(0);
    const foreignRef = await as(other.token).post('/api/v1/recruitment/jobs', { title: 'X', description: 'Y', departmentId: deptId });
    expect(foreignRef.status).toBe(400);
    expect(foreignRef.body.code).toBe('INVALID_REFERENCE');
  });
});

describe('Recruitment: employee referrals', () => {
  it('records who referred a candidate and summarises referrals for the dashboard', async () => {
    const admin = await registerOrg();
    const manju = await createEmployeeUser(admin.token, { firstName: 'Manju' });
    const nanda = await createEmployeeUser(admin.token, { firstName: 'Nanda' });
    const outsider = (await createEmployeeUser((await registerOrg()).token, { firstName: 'Out' })).employee._id;

    // Employees without recruitment access can't see the summary.
    expect((await as(manju.token).get('/api/v1/recruitment/referrals/summary')).status).toBe(403);

    const job = (await as(admin.token).post('/api/v1/recruitment/jobs', { title: 'Site Engineer', description: 'On-site work', openings: 2 })).body.data;
    expect((await as(admin.token).post(`/api/v1/recruitment/jobs/${job._id}/status`, { status: 'OPEN' })).status).toBe(200);
    const add = (overrides: Record<string, unknown>) =>
      as(admin.token).post('/api/v1/recruitment/candidates', { jobId: job._id, firstName: 'Ref', lastName: 'Cand', email: uniqueEmail('ref'), ...overrides });

    const empty = await as(admin.token).get('/api/v1/recruitment/referrals/summary');
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({ total: 0, inProcess: 0, hired: 0, recent: [], topReferrer: null });

    const r1 = await add({ source: 'REFERRAL', referredBy: manju.employee._id, firstName: 'Rohit' });
    expect(r1.status).toBe(201);
    expect(String(r1.body.data.referredBy)).toBe(manju.employee._id);
    expect((await add({ source: 'REFERRAL', referredBy: manju.employee._id, firstName: 'Pranav' })).status).toBe(201);
    expect((await add({ source: 'REFERRAL', referredBy: nanda.employee._id, firstName: 'Kiran' })).status).toBe(201);
    // A referrer on a non-referral source is dropped; a referrer from another org is rejected.
    const linkedIn = await add({ source: 'LINKEDIN', referredBy: manju.employee._id });
    expect(linkedIn.status).toBe(201);
    expect(linkedIn.body.data.referredBy).toBeNull();
    const foreign = await add({ source: 'REFERRAL', referredBy: outsider });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('INVALID_REFERENCE');

    const detail = await as(admin.token).get(`/api/v1/recruitment/candidates/${r1.body.data._id}`);
    expect(detail.body.data.referredBy).toMatchObject({ _id: manju.employee._id, firstName: 'Manju' });

    const summary = (await as(admin.token).get('/api/v1/recruitment/referrals/summary')).body.data;
    expect(summary).toMatchObject({ total: 3, inProcess: 3, hired: 0 });
    expect(summary.recent.map((c: { firstName: string }) => c.firstName)).toEqual(['Kiran', 'Pranav', 'Rohit']);
    expect(summary.recent[0].referredBy).toMatchObject({ firstName: 'Nanda' });
    expect(summary.recent[0].jobId).toMatchObject({ title: 'Site Engineer' });
    expect(summary.topReferrer).toMatchObject({ _id: manju.employee._id, firstName: 'Manju', count: 2 });

    // Changing the source away from REFERRAL clears the referrer; rejected referrals leave "in process".
    const moved = await as(admin.token).patch(`/api/v1/recruitment/candidates/${r1.body.data._id}`, { source: 'CAREERS_PAGE' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.referredBy).toBeNull();
    const kiran = summary.recent[0]._id;
    expect((await as(admin.token).post(`/api/v1/recruitment/candidates/${kiran}/stage`, { stage: 'REJECTED', rejectionReason: 'Not a fit' })).status).toBe(200);
    const after = (await as(admin.token).get('/api/v1/recruitment/referrals/summary')).body.data;
    expect(after).toMatchObject({ total: 2, inProcess: 1, hired: 0 });
    expect(after.topReferrer).toMatchObject({ firstName: 'Manju', count: 1 });
  });
});
