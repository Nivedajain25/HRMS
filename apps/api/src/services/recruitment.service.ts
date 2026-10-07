import type { FilterQuery, Types } from 'mongoose';
import {
  CANDIDATE_PIPELINE,
  CANDIDATE_STAGES,
  hireCandidateSchema,
  type CandidateStage,
  type EmployeeCreateInput,
  type PaginationQuery,
  type candidateSchema,
  type candidateStageSchema,
  type candidateUpdateSchema,
  type jobOpeningSchema,
  type jobOpeningUpdateSchema,
} from '@stencil/shared';
import type { z } from 'zod';
import {
  CandidateModel,
  EmployeeModel,
  InterviewModel,
  JobOpeningModel,
  OnboardingModel,
  type Candidate,
  type JobOpening,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { formatSequence, nextSequence } from '../utils/counter';
import { addDaysKey, dateOnly, round2, todayKey, weekdayOf, zonedInstant } from '../utils/dates';
import { badRequest, conflict, forbidden, invalidTransition, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { audit, diff } from './audit.service';
import { createEmployee } from './employee.service';
import { assertRefsInOrg } from './refs.service';
import { toObjectId } from './scope.service';

type Id = Types.ObjectId;
type JobInput = z.output<typeof jobOpeningSchema>;
type JobUpdateInput = z.output<typeof jobOpeningUpdateSchema>;
type CandidateInput = z.output<typeof candidateSchema>;
type CandidateUpdateInput = z.output<typeof candidateUpdateSchema>;
type StageInput = z.output<typeof candidateStageSchema>;
type HireInput = z.output<typeof hireCandidateSchema>;
type JobStatus = 'DRAFT' | 'OPEN' | 'ON_HOLD' | 'CLOSED';

const JOB_REFS = ['departmentId', 'designationId', 'locationId', 'hiringManagerId'];

/** Allowed job status changes (CLOSED jobs may be reopened). */
const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ['OPEN', 'CLOSED'],
  OPEN: ['ON_HOLD', 'CLOSED'],
  ON_HOLD: ['OPEN', 'CLOSED'],
  CLOSED: ['OPEN'],
};

const isDuplicateKey = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/* ================================ Access ================================= */

/**
 * `recruitment:read` sees everything; a hiring manager (employee with
 * `team:view`) sees only the jobs they manage and their candidates.
 */
export const managedJobIds = async (ctx: RequestContext): Promise<Id[] | null> => {
  if (can(ctx, 'recruitment:read')) return null;
  if (ctx.employeeId && can(ctx, 'team:view')) {
    const jobs = await JobOpeningModel.find({ organizationId: ctx.organizationId, hiringManagerId: ctx.employeeId, deletedAt: null })
      .select('_id')
      .lean();
    if (jobs.length) return jobs.map((j) => j._id);
  }
  throw forbidden('You do not have access to recruitment data');
};

const jobScope = async (ctx: RequestContext): Promise<FilterQuery<JobOpening>> => {
  const ids = await managedJobIds(ctx);
  return ids === null ? {} : { _id: { $in: ids } };
};

const candidateScope = async (ctx: RequestContext): Promise<FilterQuery<Candidate>> => {
  const ids = await managedJobIds(ctx);
  return ids === null ? {} : { jobId: { $in: ids } };
};

/* ================================== Jobs ================================= */

const JOB_POPULATE = [
  { path: 'departmentId', select: 'name code' },
  { path: 'designationId', select: 'name code' },
  { path: 'locationId', select: 'name city' },
  { path: 'hiringManagerId', select: 'employeeId firstName lastName' },
];

const stageCounts = async (ctx: RequestContext, jobIds: Id[]) => {
  const rows = await CandidateModel.aggregate<{ _id: { jobId: Id; stage: CandidateStage }; count: number }>([
    { $match: { organizationId: ctx.organizationId, jobId: { $in: jobIds }, deletedAt: null } },
    { $group: { _id: { jobId: '$jobId', stage: '$stage' }, count: { $sum: 1 } } },
  ]);
  const map = new Map<string, Partial<Record<CandidateStage, number>>>();
  for (const r of rows) {
    const key = String(r._id.jobId);
    map.set(key, { ...(map.get(key) ?? {}), [r._id.stage]: r.count });
  }
  return (jobId: Id) => {
    const byStage = map.get(String(jobId)) ?? {};
    return { candidateCounts: byStage, candidateTotal: Object.values(byStage).reduce((s, n) => s + (n ?? 0), 0) };
  };
};

export const listJobs = async (
  ctx: RequestContext,
  q: PaginationQuery & { status?: string; departmentId?: string; hiringManagerId?: string },
) => {
  const filter: FilterQuery<JobOpening> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(await jobScope(ctx)),
    ...searchFilter(q.search, ['title', 'code', 'skills']),
  };
  if (q.status) filter.status = q.status;
  if (q.departmentId) filter.departmentId = toObjectId(q.departmentId);
  if (q.hiringManagerId) filter.hiringManagerId = toObjectId(q.hiringManagerId);
  const page = await paginate(JobOpeningModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['title', 'code', 'status', 'createdAt', 'closingDate', 'publishedAt'], { createdAt: -1 }),
    populate: JOB_POPULATE,
  });
  const counts = await stageCounts(ctx, page.items.map((j) => j._id));
  return { ...page, items: page.items.map((j) => ({ ...j, ...counts(j._id) })) };
};

const findJob = async (ctx: RequestContext, id: string | Id) => {
  const job = await JobOpeningModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!job) throw notFound('Job opening');
  return job;
};

export const getJob = async (ctx: RequestContext, id: string) => {
  const job = await JobOpeningModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null, ...(await jobScope(ctx)) })
    .populate(JOB_POPULATE)
    .lean();
  if (!job) throw notFound('Job opening');
  const counts = await stageCounts(ctx, [job._id]);
  return { ...job, ...counts(job._id) };
};

const assertJobRanges = (d: { experienceMin?: number; experienceMax?: number; salaryMin?: number; salaryMax?: number }) => {
  if (d.experienceMax && d.experienceMin !== undefined && d.experienceMax < d.experienceMin) {
    throw badRequest('Maximum experience must not be below minimum', 'VALIDATION_ERROR', [{ path: 'experienceMax', message: 'Must be ≥ minimum' }]);
  }
  if (d.salaryMax && d.salaryMin !== undefined && d.salaryMax < d.salaryMin) {
    throw badRequest('Maximum salary must not be below minimum', 'VALIDATION_ERROR', [{ path: 'salaryMax', message: 'Must be ≥ minimum' }]);
  }
};

export const createJob = async (ctx: RequestContext, input: JobInput) => {
  await assertRefsInOrg(ctx.organizationId, input, JOB_REFS);
  assertJobRanges(input);
  if (input.status === 'CLOSED') throw badRequest('A job cannot be created closed', 'INVALID_STATUS');
  const code = formatSequence('JOB-', await nextSequence(ctx.organizationId, 'job'));
  const job = await JobOpeningModel.create({
    ...input,
    organizationId: ctx.organizationId,
    code,
    closingDate: input.closingDate ? dateOnly(input.closingDate) : undefined,
    publishedAt: input.status === 'OPEN' ? new Date() : undefined,
    createdBy: ctx.userId,
  });
  await audit(ctx, { action: 'RECORD_CREATED', module: 'recruitment', recordId: job._id, recordLabel: `${code} ${job.title}`, newValues: input });
  return job.toJSON();
};

export const updateJob = async (ctx: RequestContext, id: string, input: JobUpdateInput) => {
  const job = await findJob(ctx, id);
  await assertRefsInOrg(ctx.organizationId, input, JOB_REFS);
  assertJobRanges({
    experienceMin: input.experienceMin ?? job.experienceMin,
    experienceMax: input.experienceMax ?? job.experienceMax,
    salaryMin: input.salaryMin ?? job.salaryMin,
    salaryMax: input.salaryMax ?? job.salaryMax,
  });
  if (input.openings !== undefined && input.openings < job.filled) {
    throw unprocessable(`Openings cannot be fewer than the ${job.filled} position(s) already filled`, 'OPENINGS_BELOW_FILLED');
  }
  const before = job.toObject() as unknown as Record<string, unknown>;
  const { closingDate, ...rest } = input;
  job.set(rest);
  if (closingDate !== undefined) job.set('closingDate', closingDate ? dateOnly(closingDate) : null);
  await job.save();
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'recruitment', recordId: job._id, recordLabel: `${job.code} ${job.title}`, ...diff(before, input as Record<string, unknown>) });
  return job.toJSON();
};

export const setJobStatus = async (ctx: RequestContext, id: string, input: { status: JobStatus }) => {
  const job = await findJob(ctx, id);
  const from = job.status as JobStatus;
  if (from === input.status) return job.toJSON();
  if (!JOB_TRANSITIONS[from].includes(input.status)) throw invalidTransition('Job opening', from, input.status);
  if (from === 'CLOSED' && input.status === 'OPEN' && job.filled >= job.openings) {
    throw unprocessable('All openings are filled; increase openings before reopening', 'JOB_FILLED');
  }
  job.status = input.status;
  if (input.status === 'OPEN' && !job.publishedAt) job.publishedAt = new Date();
  await job.save();
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'recruitment',
    recordId: job._id,
    recordLabel: `${job.code} ${job.title}`,
    oldValues: { status: from },
    newValues: { status: input.status },
  });
  return job.toJSON();
};

/** Soft-deletes a job without candidates; otherwise closes it (candidate history is kept). */
export const removeJob = async (ctx: RequestContext, id: string) => {
  const job = await findJob(ctx, id);
  const hasCandidates = await CandidateModel.exists({ organizationId: ctx.organizationId, jobId: job._id, deletedAt: null });
  if (hasCandidates) {
    const from = job.status;
    job.status = 'CLOSED';
    await job.save();
    await audit(ctx, { action: 'RECORD_UPDATED', module: 'recruitment', recordId: job._id, recordLabel: `${job.code} ${job.title}`, oldValues: { status: from }, newValues: { status: 'CLOSED' } });
    return { deleted: false, closed: true };
  }
  job.deletedAt = new Date();
  await job.save();
  await audit(ctx, { action: 'RECORD_DELETED', module: 'recruitment', recordId: job._id, recordLabel: `${job.code} ${job.title}` });
  return { deleted: true, closed: false };
};

/* =============================== Candidates ============================== */

const CANDIDATE_POPULATE = [
  { path: 'jobId', select: 'code title status departmentId' },
  { path: 'hiredEmployeeId', select: 'employeeId firstName lastName' },
  { path: 'referredBy', select: 'employeeId firstName lastName' },
];

export const listCandidates = async (
  ctx: RequestContext,
  q: PaginationQuery & { jobId?: string; stage?: string; source?: string },
) => {
  const filter: FilterQuery<Candidate> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...searchFilter(q.search, ['firstName', 'lastName', 'email', 'skills']),
  };
  const managed = await managedJobIds(ctx);
  if (q.jobId) {
    const jobId = toObjectId(q.jobId);
    filter.jobId = managed === null || managed.some((j) => j.equals(jobId)) ? jobId : { $in: [] };
  } else if (managed !== null) {
    filter.jobId = { $in: managed };
  }
  if (q.stage) filter.stage = q.stage;
  if (q.source) filter.source = q.source;
  return paginate(CandidateModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['firstName', 'lastName', 'createdAt', 'stage', 'experienceYears', 'rating'], { createdAt: -1 }),
    populate: [
      { path: 'jobId', select: 'code title status' },
      { path: 'referredBy', select: 'employeeId firstName lastName' },
    ],
  });
};

const findCandidate = async (ctx: RequestContext, id: string | Id) => {
  const candidate = await CandidateModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!candidate) throw notFound('Candidate');
  return candidate;
};

export const getCandidate = async (ctx: RequestContext, id: string) => {
  const candidate = await CandidateModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null, ...(await candidateScope(ctx)) })
    .populate(CANDIDATE_POPULATE)
    .populate({ path: 'stageHistory.by', select: 'firstName lastName', model: 'User' })
    .lean();
  if (!candidate) throw notFound('Candidate');
  const interviews = await InterviewModel.find({ organizationId: ctx.organizationId, candidateId: candidate._id })
    .populate({ path: 'interviewerIds', select: 'employeeId firstName lastName' })
    .sort({ scheduledAt: 1 })
    .lean();
  return { ...candidate, interviews };
};

export const createCandidate = async (ctx: RequestContext, input: CandidateInput) => {
  const job = await JobOpeningModel.findOne({ _id: input.jobId, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!job) throw badRequest('Job opening not found', 'INVALID_REFERENCE', [{ path: 'jobId', message: 'Job opening not found' }]);
  if (job.status !== 'OPEN') throw unprocessable('Candidates can only be added to open jobs', 'JOB_NOT_OPEN');
  await assertRefsInOrg(ctx.organizationId, input, ['resumeFileId', 'referredBy']);
  if (await CandidateModel.exists({ organizationId: ctx.organizationId, jobId: job._id, email: input.email })) {
    throw conflict('This candidate has already applied for this job', 'DUPLICATE_CANDIDATE');
  }
  try {
    const candidate = await CandidateModel.create({
      ...input,
      // A referrer only makes sense for referrals.
      referredBy: input.source === 'REFERRAL' ? (input.referredBy ?? null) : null,
      organizationId: ctx.organizationId,
      jobId: job._id,
      stage: 'APPLIED',
      stageHistory: [{ from: null, to: 'APPLIED', note: 'Application received', by: ctx.userId, at: new Date() }],
      createdBy: ctx.userId,
    });
    await audit(ctx, {
      action: 'RECORD_CREATED',
      module: 'recruitment',
      recordId: candidate._id,
      recordLabel: `Candidate ${candidate.firstName} ${candidate.lastName} (${job.code})`,
      newValues: { jobId: job._id, email: candidate.email, source: candidate.source },
    });
    return candidate.toJSON();
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('This candidate has already applied for this job', 'DUPLICATE_CANDIDATE');
    throw err;
  }
};

export const updateCandidate = async (ctx: RequestContext, id: string, input: CandidateUpdateInput) => {
  const candidate = await findCandidate(ctx, id);
  await assertRefsInOrg(ctx.organizationId, input, ['resumeFileId', 'referredBy']);
  if (input.email && input.email !== candidate.email) {
    const dup = await CandidateModel.exists({ organizationId: ctx.organizationId, jobId: candidate.jobId, email: input.email, _id: { $ne: candidate._id } });
    if (dup) throw conflict('Another candidate for this job uses this email', 'DUPLICATE_CANDIDATE');
  }
  const before = candidate.toObject() as unknown as Record<string, unknown>;
  candidate.set(input);
  if (candidate.source !== 'REFERRAL') candidate.set('referredBy', null);
  try {
    await candidate.save();
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('Another candidate for this job uses this email', 'DUPLICATE_CANDIDATE');
    throw err;
  }
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'recruitment',
    recordId: candidate._id,
    recordLabel: `Candidate ${candidate.firstName} ${candidate.lastName}`,
    ...diff(before, input as Record<string, unknown>),
  });
  return candidate.toJSON();
};

/**
 * Moves a candidate along CANDIDATE_PIPELINE. HIRED is only reachable through
 * the hire endpoint (which creates the employee); rejection needs a reason.
 */
export const moveCandidateStage = async (ctx: RequestContext, id: string, input: StageInput) => {
  const candidate = await findCandidate(ctx, id);
  const from = candidate.stage as CandidateStage;
  const to = input.stage;
  if (from === to) throw unprocessable(`Candidate is already in ${to.toLowerCase()}`, 'SAME_STAGE');
  if (!CANDIDATE_PIPELINE.can(from, to)) throw invalidTransition('Candidate', from, to);
  if (to === 'HIRED') throw unprocessable('Use the hire action to hire a candidate', 'USE_HIRE_ENDPOINT');
  if (to === 'REJECTED' && !input.rejectionReason) {
    throw badRequest('A rejection reason is required', 'VALIDATION_ERROR', [{ path: 'rejectionReason', message: 'Required when rejecting' }]);
  }
  const updated = await CandidateModel.findOneAndUpdate(
    { _id: candidate._id, organizationId: ctx.organizationId, stage: from, hiringStartedAt: null },
    {
      stage: to,
      ...(to === 'REJECTED' ? { rejectionReason: input.rejectionReason } : {}),
      $push: { stageHistory: { from, to, note: input.note ?? input.rejectionReason, by: ctx.userId, at: new Date() } },
    },
    { new: true },
  );
  if (!updated) throw conflict('The candidate was changed by someone else; reload and try again');
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'recruitment',
    recordId: updated._id,
    recordLabel: `Candidate ${updated.firstName} ${updated.lastName}`,
    oldValues: { stage: from },
    newValues: { stage: to, ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}) },
  });
  return updated.toJSON();
};

/** Kanban: candidates grouped by stage, in pipeline order. */
export const pipeline = async (ctx: RequestContext, q: { jobId?: string }) => {
  const filter: FilterQuery<Candidate> = { organizationId: ctx.organizationId, deletedAt: null, ...(await candidateScope(ctx)) };
  let job: unknown = null;
  if (q.jobId) {
    job = await JobOpeningModel.findOne({ _id: q.jobId, organizationId: ctx.organizationId, deletedAt: null, ...(await jobScope(ctx)) })
      .select('code title status openings filled')
      .lean();
    if (!job) throw notFound('Job opening');
    filter.jobId = toObjectId(q.jobId);
  }
  const candidates = await CandidateModel.find(filter)
    .select('firstName lastName email phone stage source rating experienceYears skills jobId createdAt updatedAt')
    .populate({ path: 'jobId', select: 'code title' })
    .sort({ updatedAt: -1 })
    .limit(1000)
    .lean();
  return {
    job,
    stages: CANDIDATE_STAGES.map((stage) => {
      const items = candidates.filter((c) => c.stage === stage);
      return { stage, count: items.length, candidates: items };
    }),
  };
};

/* ================================ Hiring ================================= */

const idOrNull = (v: unknown) => (v ? String(v) : null);

export const hirePrefill = async (ctx: RequestContext, id: string) => {
  const candidate = await findCandidate(ctx, id);
  const job = await JobOpeningModel.findOne({ _id: candidate.jobId, organizationId: ctx.organizationId }).lean();
  if (!job) throw notFound('Job opening');
  return {
    candidateId: candidate._id,
    stage: candidate.stage,
    canHire: CANDIDATE_PIPELINE.can(candidate.stage as CandidateStage, 'HIRED') && !candidate.hiringStartedAt,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    personalEmail: candidate.email,
    phone: candidate.phone ?? null,
    departmentId: idOrNull(job.departmentId),
    designationId: idOrNull(job.designationId),
    locationId: idOrNull(job.locationId),
    managerId: idOrNull(job.hiringManagerId),
    employmentType: job.employmentType,
    joiningDate: todayKey(ctx.timezone),
    job: { _id: job._id, code: job.code, title: job.title },
  };
};

/** Picks the explicit value (including an explicit null) over the job default. */
const pick = (explicit: string | null | undefined, fallback: unknown) =>
  explicit !== undefined ? explicit : fallback ? String(fallback) : null;

/**
 * Hires an OFFERED candidate: creates the employee (user account, leave
 * balances and onboarding via `createEmployee`), marks the candidate HIRED,
 * links the onboarding to the candidate and fills the job (auto-closing it
 * when all openings are filled).
 */
export const hireCandidate = async (ctx: RequestContext, id: string, raw: HireInput) => {
  const input = hireCandidateSchema.parse(raw);
  const candidate = await findCandidate(ctx, id);
  const from = candidate.stage as CandidateStage;
  if (!CANDIDATE_PIPELINE.can(from, 'HIRED')) throw invalidTransition('Candidate', from, 'HIRED');
  const job = await JobOpeningModel.findOne({ _id: candidate.jobId, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!job) throw notFound('Job opening');

  // Claim the candidate so concurrent hire requests cannot create two employees.
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const claimed = await CandidateModel.findOneAndUpdate(
    {
      _id: candidate._id,
      organizationId: ctx.organizationId,
      stage: from,
      $or: [{ hiringStartedAt: null }, { hiringStartedAt: { $lt: staleBefore } }],
    },
    { hiringStartedAt: new Date() },
    { new: true },
  );
  if (!claimed) throw conflict('This candidate is already being hired', 'HIRE_IN_PROGRESS');

  let employee: Record<string, unknown>;
  try {
    const employeeInput: EmployeeCreateInput = {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      personalEmail: candidate.email,
      phone: candidate.phone ?? undefined,
      workEmail: input.workEmail,
      joiningDate: input.joiningDate,
      departmentId: pick(input.departmentId, job.departmentId),
      designationId: pick(input.designationId, job.designationId),
      locationId: pick(input.locationId, job.locationId),
      managerId: pick(input.managerId, job.hiringManagerId),
      employmentType: input.employmentType ?? job.employmentType,
      onboardingTemplateId: input.onboardingTemplateId,
      createUserAccount: input.createUserAccount,
    };
    employee = (await createEmployee(ctx, employeeInput)) as Record<string, unknown>;
  } catch (err) {
    await CandidateModel.updateOne({ _id: candidate._id, organizationId: ctx.organizationId }, { hiringStartedAt: null });
    throw err;
  }
  const employeeId = toObjectId(String(employee._id));

  const { onboardingId, jobAfter } = await withTransaction(async (session) => {
    const hiredAt = new Date();
    await CandidateModel.updateOne(
      { _id: candidate._id, organizationId: ctx.organizationId },
      {
        stage: 'HIRED',
        hiredEmployeeId: employeeId,
        hiredAt,
        hiringStartedAt: null,
        $push: { stageHistory: { from, to: 'HIRED', note: `Hired as ${String(employee.employeeId ?? '')}`.trim(), by: ctx.userId, at: hiredAt } },
      },
      { session },
    );
    const onboarding = await OnboardingModel.findOneAndUpdate(
      { organizationId: ctx.organizationId, employeeId },
      { candidateId: candidate._id },
      { new: true, sort: { createdAt: -1 }, session },
    );
    const filledJob = await JobOpeningModel.findOneAndUpdate(
      { _id: job._id, organizationId: ctx.organizationId },
      { $inc: { filled: 1 } },
      { new: true, session },
    );
    let jobAfter = filledJob;
    if (filledJob && filledJob.filled >= filledJob.openings && filledJob.status !== 'CLOSED') {
      jobAfter = await JobOpeningModel.findOneAndUpdate({ _id: job._id, organizationId: ctx.organizationId }, { status: 'CLOSED' }, { new: true, session });
    }
    return { onboardingId: onboarding?._id ?? null, jobAfter };
  });

  await audit(ctx, {
    action: 'CANDIDATE_HIRED',
    module: 'recruitment',
    recordId: candidate._id,
    recordLabel: `${candidate.firstName} ${candidate.lastName} → ${String(employee.employeeId ?? '')}`,
    oldValues: { stage: from },
    newValues: { stage: 'HIRED', employeeId, jobId: job._id, onboardingId },
  });
  return {
    employee,
    onboardingId,
    candidateId: candidate._id,
    job: jobAfter ? { _id: jobAfter._id, filled: jobAfter.filled, openings: jobAfter.openings, status: jobAfter.status } : null,
  };
};

/* ================================ Summary ================================ */

/** Monday 00:00 of the current week in the org timezone → next Monday. */
const weekRange = (tz: string) => {
  const today = todayKey(tz);
  const order = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const monday = addDaysKey(today, -order.indexOf(weekdayOf(today)));
  return { from: zonedInstant(monday, '00:00', tz), to: zonedInstant(addDaysKey(monday, 7), '00:00', tz) };
};

export const recruitmentSummary = async (ctx: RequestContext) => {
  if (!can(ctx, 'recruitment:read')) throw forbidden();
  const org = ctx.organizationId;
  const week = weekRange(ctx.timezone);
  const [jobsByStatus, byStage, bySource, interviewsThisWeek, tth] = await Promise.all([
    JobOpeningModel.aggregate<{ _id: string; count: number; openings: number; filled: number }>([
      { $match: { organizationId: org, deletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 }, openings: { $sum: '$openings' }, filled: { $sum: '$filled' } } },
    ]),
    CandidateModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: org, deletedAt: null } },
      { $group: { _id: '$stage', count: { $sum: 1 } } },
    ]),
    CandidateModel.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: org, deletedAt: null } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    InterviewModel.countDocuments({ organizationId: org, status: { $ne: 'CANCELLED' }, scheduledAt: { $gte: week.from, $lt: week.to } }),
    CandidateModel.aggregate<{ avgMs: number; count: number }>([
      { $match: { organizationId: org, stage: 'HIRED', hiredAt: { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ['$hiredAt', '$createdAt'] } }, count: { $sum: 1 } } },
    ]),
  ]);
  const open = jobsByStatus.find((j) => j._id === 'OPEN');
  return {
    openJobs: open?.count ?? 0,
    openPositions: open ? Math.max(0, open.openings - open.filled) : 0,
    jobsByStatus: Object.fromEntries(jobsByStatus.map((j) => [j._id, j.count])),
    candidatesByStage: Object.fromEntries(CANDIDATE_STAGES.map((s) => [s, byStage.find((b) => b._id === s)?.count ?? 0])),
    totalCandidates: byStage.reduce((s, b) => s + b.count, 0),
    sourceBreakdown: bySource.map((s) => ({ source: s._id, count: s.count })),
    interviewsThisWeek,
    hires: tth[0]?.count ?? 0,
    timeToHireAvgDays: tth[0] ? round2(tth[0].avgMs / 86_400_000) : null,
  };
};

/** Dashboard "Referrals" card: candidates whose source is REFERRAL — counts, the latest few and the top referrer. */
export const referralSummary = async (ctx: RequestContext) => {
  if (!can(ctx, 'recruitment:read')) throw forbidden();
  const match = { organizationId: ctx.organizationId, deletedAt: null, source: 'REFERRAL' };
  const [byStage, recent, top] = await Promise.all([
    CandidateModel.aggregate<{ _id: CandidateStage; count: number }>([{ $match: match }, { $group: { _id: '$stage', count: { $sum: 1 } } }]),
    CandidateModel.find(match)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('firstName lastName stage jobId referredBy createdAt')
      .populate({ path: 'jobId', select: 'code title' })
      .populate({ path: 'referredBy', select: 'employeeId firstName lastName profilePhoto' })
      .lean(),
    CandidateModel.aggregate<{ _id: Id; count: number }>([
      { $match: { ...match, referredBy: { $ne: null } } },
      { $group: { _id: '$referredBy', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 1 },
    ]),
  ]);
  const inStage = (s: CandidateStage) => byStage.find((b) => b._id === s)?.count ?? 0;
  const total = byStage.reduce((s, b) => s + b.count, 0);
  const topEmployee = top[0]
    ? await EmployeeModel.findOne({ _id: top[0]._id, organizationId: ctx.organizationId }).select('employeeId firstName lastName profilePhoto').lean()
    : null;
  return {
    total,
    inProcess: total - inStage('HIRED') - inStage('REJECTED'),
    hired: inStage('HIRED'),
    recent,
    topReferrer: topEmployee && top[0] ? { ...topEmployee, count: top[0].count } : null,
  };
};
