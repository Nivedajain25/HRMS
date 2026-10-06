import type { FilterQuery, Types } from 'mongoose';
import {
  CANDIDATE_PIPELINE,
  type CandidateStage,
  type PaginationQuery,
  type interviewFeedbackSchema,
  type interviewSchema,
  type interviewStatusSchema,
  type interviewUpdateSchema,
} from '@stencil/shared';
import type { z } from 'zod';
import { CandidateModel, EmployeeModel, InterviewModel, JobOpeningModel, type Interview } from '../models';
import { can, type RequestContext } from '../types/context';
import { addDaysKey, dateKeyInTz, round2, timeInTz, zonedInstant } from '../utils/dates';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate } from '../utils/pagination';
import { audit } from './audit.service';
import { sendEmail } from './email.service';
import { notify, userIdsForEmployees } from './notification.service';
import { toObjectId } from './scope.service';

type Id = Types.ObjectId;
type InterviewInput = z.output<typeof interviewSchema>;
type InterviewUpdateInput = z.output<typeof interviewUpdateSchema>;
type StatusInput = z.output<typeof interviewStatusSchema>;
type FeedbackInput = z.output<typeof interviewFeedbackSchema>;

const CLOSED_STAGES = new Set<CandidateStage>(['HIRED', 'REJECTED']);
/** Longest allowed interview; bounds the overlap search window. */
const MAX_DURATION_MIN = 480;

/**
 * `recruitment:read` sees every interview; anyone else only the interviews
 * they are an interviewer on.
 */
const accessFilter = (ctx: RequestContext): FilterQuery<Interview> => {
  if (can(ctx, 'recruitment:read')) return {};
  if (ctx.employeeId) return { interviewerIds: ctx.employeeId };
  throw forbidden('You do not have access to interviews');
};

const POPULATE = [
  { path: 'candidateId', select: 'firstName lastName email phone stage' },
  { path: 'jobId', select: 'code title' },
  { path: 'interviewerIds', select: 'employeeId firstName lastName profilePhoto' },
];

export const listInterviews = async (
  ctx: RequestContext,
  q: PaginationQuery & { candidateId?: string; jobId?: string; interviewerId?: string; status?: string; from?: string; to?: string },
) => {
  const filter: FilterQuery<Interview> = { organizationId: ctx.organizationId, ...accessFilter(ctx) };
  if (q.candidateId) filter.candidateId = toObjectId(q.candidateId);
  if (q.jobId) filter.jobId = toObjectId(q.jobId);
  if (q.status) filter.status = q.status;
  if (q.interviewerId) {
    const who = q.interviewerId === 'me' ? ctx.employeeId : toObjectId(q.interviewerId);
    if (!who) return { items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
    filter.$and = [{ interviewerIds: who }];
  }
  if (q.from || q.to) {
    filter.scheduledAt = {
      ...(q.from ? { $gte: zonedInstant(q.from, '00:00', ctx.timezone) } : {}),
      ...(q.to ? { $lt: zonedInstant(addDaysKey(q.to, 1), '00:00', ctx.timezone) } : {}),
    };
  }
  return paginate(InterviewModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['scheduledAt', 'status', 'round', 'createdAt'], { scheduledAt: 1 }),
    populate: POPULATE,
  });
};

export const getInterview = async (ctx: RequestContext, id: string) => {
  const interview = await InterviewModel.findOne({ _id: id, organizationId: ctx.organizationId, ...accessFilter(ctx) })
    .populate(POPULATE)
    .lean();
  if (!interview) throw notFound('Interview');
  return interview;
};

const assertInterviewers = async (ctx: RequestContext, ids: string[]) => {
  const unique = [...new Set(ids)];
  const employees = await EmployeeModel.find({
    _id: { $in: unique },
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
  })
    .select('_id firstName lastName userId')
    .lean();
  if (employees.length !== unique.length) {
    throw badRequest('One or more interviewers were not found', 'INVALID_REFERENCE', [{ path: 'interviewerIds', message: 'Interviewer not found' }]);
  }
  return employees;
};

/** 409 when any interviewer already has a scheduled interview overlapping [start, end). */
const assertNoDoubleBooking = async (ctx: RequestContext, interviewerIds: Id[], start: Date, durationMinutes: number, excludeId?: Id) => {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const candidates = await InterviewModel.find({
    organizationId: ctx.organizationId,
    status: 'SCHEDULED',
    interviewerIds: { $in: interviewerIds },
    scheduledAt: { $lt: end, $gt: new Date(start.getTime() - MAX_DURATION_MIN * 60_000) },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('scheduledAt durationMinutes interviewerIds')
    .lean();
  const clash = candidates.find((i) => i.scheduledAt.getTime() + (i.durationMinutes ?? 60) * 60_000 > start.getTime());
  if (clash) {
    const busy = interviewerIds.filter((id) => clash.interviewerIds.some((x) => x.equals(id)));
    const people = await EmployeeModel.find({ _id: { $in: busy }, organizationId: ctx.organizationId }).select('firstName lastName').lean();
    throw conflict(
      `Interviewer already booked at this time: ${people.map((p) => `${p.firstName} ${p.lastName}`).join(', ')}`,
      'INTERVIEWER_CONFLICT',
    );
  }
};

const whenLabel = (ctx: RequestContext, at: Date) => `${dateKeyInTz(at, ctx.timezone)} ${timeInTz(at, ctx.timezone)} (${ctx.timezone})`;

const announce = async (
  ctx: RequestContext,
  interview: { _id: Id; scheduledAt: Date; type?: string | null; meetingLink?: string | null; interviewerIds: Id[] },
  candidate: { firstName: string; lastName: string; email: string },
  jobTitle: string,
  rescheduled: boolean,
) => {
  const when = whenLabel(ctx, interview.scheduledAt);
  await notify({
    organizationId: ctx.organizationId,
    userIds: await userIdsForEmployees(ctx.organizationId, interview.interviewerIds),
    type: 'INTERVIEW_SCHEDULED',
    title: rescheduled ? 'Interview rescheduled' : 'Interview scheduled',
    message: `${candidate.firstName} ${candidate.lastName} for ${jobTitle} on ${when}.`,
    link: `/recruitment/interviews/${interview._id}`,
    entityType: 'Interview',
    entityId: interview._id,
    excludeUserId: ctx.userId,
  });
  await sendEmail(
    candidate.email,
    'interview',
    { name: candidate.firstName, when, type: String(interview.type ?? 'VIDEO'), meetingLink: interview.meetingLink ?? undefined, job: jobTitle },
    ctx.organizationId,
  );
};

export const scheduleInterview = async (ctx: RequestContext, input: InterviewInput) => {
  const candidate = await CandidateModel.findOne({ _id: input.candidateId, organizationId: ctx.organizationId, deletedAt: null });
  if (!candidate) throw badRequest('Candidate not found', 'INVALID_REFERENCE', [{ path: 'candidateId', message: 'Candidate not found' }]);
  if (CLOSED_STAGES.has(candidate.stage as CandidateStage)) {
    throw unprocessable(`Cannot schedule interviews for a ${candidate.stage.toLowerCase()} candidate`, 'CANDIDATE_CLOSED');
  }
  const job = await JobOpeningModel.findOne({ _id: candidate.jobId, organizationId: ctx.organizationId }).select('title').lean();
  const interviewers = await assertInterviewers(ctx, input.interviewerIds);
  const scheduledAt = zonedInstant(input.date, input.startTime, ctx.timezone);
  if (scheduledAt.getTime() < Date.now()) throw badRequest('Interviews cannot be scheduled in the past', 'PAST_DATE', [{ path: 'date', message: 'Must be in the future' }]);
  const interviewerIds = interviewers.map((e) => e._id);
  await assertNoDoubleBooking(ctx, interviewerIds, scheduledAt, input.durationMinutes);

  const { date: _d, startTime: _t, ...rest } = input;
  void _d;
  void _t;
  const interview = await InterviewModel.create({
    ...rest,
    organizationId: ctx.organizationId,
    candidateId: candidate._id,
    jobId: candidate.jobId,
    interviewerIds,
    scheduledAt,
    status: 'SCHEDULED',
    createdBy: ctx.userId,
  });

  const from = candidate.stage as CandidateStage;
  if (from !== 'INTERVIEW' && CANDIDATE_PIPELINE.can(from, 'INTERVIEW')) {
    await CandidateModel.updateOne(
      { _id: candidate._id, organizationId: ctx.organizationId, stage: from },
      { stage: 'INTERVIEW', $push: { stageHistory: { from, to: 'INTERVIEW', note: `Interview round ${input.round} scheduled`, by: ctx.userId, at: new Date() } } },
    );
  }
  await audit(ctx, {
    action: 'RECORD_CREATED',
    module: 'recruitment',
    recordId: interview._id,
    recordLabel: `Interview: ${candidate.firstName} ${candidate.lastName}`,
    newValues: { candidateId: candidate._id, scheduledAt, interviewerIds, round: input.round },
  });
  await announce(ctx, interview, candidate, job?.title ?? 'the role', false);
  return interview.toJSON();
};

export const updateInterview = async (ctx: RequestContext, id: string, input: InterviewUpdateInput) => {
  const interview = await InterviewModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!interview) throw notFound('Interview');
  if (interview.status !== 'SCHEDULED') throw unprocessable('Only scheduled interviews can be changed', 'INTERVIEW_CLOSED');

  const interviewerIds = input.interviewerIds ? (await assertInterviewers(ctx, input.interviewerIds)).map((e) => e._id) : interview.interviewerIds;
  const date = input.date ?? dateKeyInTz(interview.scheduledAt, ctx.timezone);
  const time = input.startTime ?? timeInTz(interview.scheduledAt, ctx.timezone);
  const scheduledAt = zonedInstant(date, time, ctx.timezone);
  const duration = input.durationMinutes ?? interview.durationMinutes ?? 60;
  const moved = scheduledAt.getTime() !== interview.scheduledAt.getTime();
  if (moved && scheduledAt.getTime() < Date.now()) throw badRequest('Interviews cannot be scheduled in the past', 'PAST_DATE');
  await assertNoDoubleBooking(ctx, interviewerIds, scheduledAt, duration, interview._id);

  const before = { scheduledAt: interview.scheduledAt, durationMinutes: interview.durationMinutes, interviewerIds: interview.interviewerIds };
  const { date: _d, startTime: _t, interviewerIds: _i, ...rest } = input;
  void _d;
  void _t;
  void _i;
  interview.set({ ...rest, scheduledAt, durationMinutes: duration, interviewerIds });
  if (moved) interview.rescheduleCount = (interview.rescheduleCount ?? 0) + 1;
  await interview.save();
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'recruitment',
    recordId: interview._id,
    recordLabel: 'Interview rescheduled',
    oldValues: before,
    newValues: { scheduledAt, durationMinutes: duration, interviewerIds },
  });

  if (moved || input.interviewerIds || input.meetingLink !== undefined || input.type !== undefined) {
    const candidate = await CandidateModel.findOne({ _id: interview.candidateId, organizationId: ctx.organizationId }).lean();
    const job = await JobOpeningModel.findOne({ _id: interview.jobId, organizationId: ctx.organizationId }).select('title').lean();
    if (candidate) await announce(ctx, interview, candidate, job?.title ?? 'the role', true);
  }
  return interview.toJSON();
};

export const setInterviewStatus = async (ctx: RequestContext, id: string, input: StatusInput) => {
  const interview = await InterviewModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!interview) throw notFound('Interview');
  if (interview.status !== 'SCHEDULED' || input.status === 'SCHEDULED') {
    throw unprocessable(`Interview cannot move from ${interview.status.toLowerCase()} to ${input.status.toLowerCase()}`, 'INVALID_TRANSITION');
  }
  if (input.status === 'CANCELLED' && !input.reason) {
    throw badRequest('A cancellation reason is required', 'VALIDATION_ERROR', [{ path: 'reason', message: 'Required when cancelling' }]);
  }
  const from = interview.status;
  interview.status = input.status;
  if (input.status === 'CANCELLED') interview.cancellationReason = input.reason;
  else if (input.reason) interview.notes = [interview.notes, input.reason].filter(Boolean).join('\n');
  await interview.save();
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'recruitment',
    recordId: interview._id,
    recordLabel: 'Interview status',
    oldValues: { status: from },
    newValues: { status: input.status, reason: input.reason },
  });
  if (input.status === 'CANCELLED') {
    await notify({
      organizationId: ctx.organizationId,
      userIds: await userIdsForEmployees(ctx.organizationId, interview.interviewerIds),
      type: 'INTERVIEW_SCHEDULED',
      title: 'Interview cancelled',
      message: `An interview on ${whenLabel(ctx, interview.scheduledAt)} was cancelled: ${input.reason}`,
      link: `/recruitment/interviews/${interview._id}`,
      excludeUserId: ctx.userId,
    });
  }
  return interview.toJSON();
};

/**
 * Records one interviewer's feedback (one per interviewer). The interview
 * rating becomes the average of all feedback, the interview is marked
 * COMPLETED and the candidate's rating is the average across interviews.
 */
export const submitFeedback = async (ctx: RequestContext, id: string, input: FeedbackInput) => {
  const interview = await InterviewModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!interview) throw notFound('Interview');
  const isInterviewer = !!ctx.employeeId && interview.interviewerIds.some((i) => i.equals(ctx.employeeId!));
  if (!isInterviewer && !can(ctx, 'recruitment:update')) throw forbidden('Only assigned interviewers can submit feedback');
  if (interview.status === 'CANCELLED' || interview.status === 'NO_SHOW') {
    throw unprocessable(`Feedback cannot be added to a ${interview.status.toLowerCase().replace('_', '-')} interview`, 'INTERVIEW_CLOSED');
  }
  const reviewerId = ctx.employeeId ?? ctx.userId;
  if (interview.feedback.some((f) => f.interviewerId?.equals(reviewerId))) {
    throw conflict('You have already submitted feedback for this interview', 'DUPLICATE_FEEDBACK');
  }

  const entry = { interviewerId: reviewerId, interviewerName: ctx.userName, ...input, at: new Date() };
  const updated = await InterviewModel.findOneAndUpdate(
    { _id: interview._id, organizationId: ctx.organizationId, 'feedback.interviewerId': { $ne: reviewerId } },
    { $push: { feedback: entry } },
    { new: true },
  );
  if (!updated) throw conflict('You have already submitted feedback for this interview', 'DUPLICATE_FEEDBACK');
  const ratings = updated.feedback.map((f) => f.rating).filter((r): r is number => typeof r === 'number');
  updated.rating = ratings.length ? round2(ratings.reduce((s, r) => s + r, 0) / ratings.length) : undefined;
  updated.status = 'COMPLETED';
  await updated.save();

  const rated = await InterviewModel.find({ organizationId: ctx.organizationId, candidateId: updated.candidateId, rating: { $ne: null } })
    .select('rating')
    .lean();
  const values = rated.map((r) => r.rating).filter((r): r is number => typeof r === 'number');
  if (values.length) {
    await CandidateModel.updateOne(
      { _id: updated.candidateId, organizationId: ctx.organizationId },
      { rating: round2(values.reduce((s, r) => s + r, 0) / values.length) },
    );
  }
  await audit(ctx, {
    action: 'RECORD_UPDATED',
    module: 'recruitment',
    recordId: updated._id,
    recordLabel: 'Interview feedback',
    newValues: { rating: input.rating, recommendation: input.recommendation },
  });
  return updated.toJSON();
};
