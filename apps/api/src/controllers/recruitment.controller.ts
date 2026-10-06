import type { Request } from 'express';
import type { PaginationQuery } from '@stencil/shared';
import { body, query } from '../middleware/validate';
import * as interviews from '../services/interview.service';
import * as rec from '../services/recruitment.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type Q = PaginationQuery & Record<string, string | undefined>;
const q = (req: Request) => query<Q>(req);

export const recruitmentController = {
  // Jobs
  listJobs: handlePaged((ctx, req) => rec.listJobs(ctx, q(req))),
  getJob: handle((ctx, req) => rec.getJob(ctx, idOf(req))),
  createJob: handleCreated((ctx, req) => rec.createJob(ctx, body(req)), 'Job opening created'),
  updateJob: handle((ctx, req) => rec.updateJob(ctx, idOf(req), body(req)), 'Job opening updated'),
  setJobStatus: handle((ctx, req) => rec.setJobStatus(ctx, idOf(req), body(req)), 'Job status updated'),
  removeJob: handle((ctx, req) => rec.removeJob(ctx, idOf(req)), 'Job opening removed'),

  // Candidates
  listCandidates: handlePaged((ctx, req) => rec.listCandidates(ctx, q(req))),
  getCandidate: handle((ctx, req) => rec.getCandidate(ctx, idOf(req))),
  createCandidate: handleCreated((ctx, req) => rec.createCandidate(ctx, body(req)), 'Candidate added'),
  updateCandidate: handle((ctx, req) => rec.updateCandidate(ctx, idOf(req), body(req)), 'Candidate updated'),
  moveStage: handle((ctx, req) => rec.moveCandidateStage(ctx, idOf(req), body(req)), 'Candidate stage updated'),
  pipeline: handle((ctx, req) => rec.pipeline(ctx, query<{ jobId?: string }>(req))),
  hirePrefill: handle((ctx, req) => rec.hirePrefill(ctx, idOf(req))),
  hire: handleCreated((ctx, req) => rec.hireCandidate(ctx, idOf(req), body(req)), 'Candidate hired'),

  // Interviews
  listInterviews: handlePaged((ctx, req) => interviews.listInterviews(ctx, q(req))),
  getInterview: handle((ctx, req) => interviews.getInterview(ctx, idOf(req))),
  scheduleInterview: handleCreated((ctx, req) => interviews.scheduleInterview(ctx, body(req)), 'Interview scheduled'),
  updateInterview: handle((ctx, req) => interviews.updateInterview(ctx, idOf(req), body(req)), 'Interview updated'),
  interviewStatus: handle((ctx, req) => interviews.setInterviewStatus(ctx, idOf(req), body(req)), 'Interview status updated'),
  interviewFeedback: handle((ctx, req) => interviews.submitFeedback(ctx, idOf(req), body(req)), 'Feedback submitted'),

  summary: handle((ctx) => rec.recruitmentSummary(ctx)),
};
