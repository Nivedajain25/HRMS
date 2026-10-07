import { z } from 'zod';
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STAGES,
  INTERVIEW_STATUS,
  JOB_STATUS,
  candidateSchema,
  candidateStageSchema,
  candidateUpdateSchema,
  hireCandidateSchema,
  idParam,
  interviewFeedbackSchema,
  interviewSchema,
  interviewStatusSchema,
  interviewUpdateSchema,
  jobOpeningSchema,
  jobOpeningUpdateSchema,
  jobStatusSchema,
  objectId,
  optionalDateString,
  optionalObjectId,
  paginationQuery,
} from '@stencil/shared';
import { recruitmentController as c } from '../controllers/recruitment.controller';
import { createModule } from './registry';

export const recruitmentModule = createModule('Recruitment', '/api/v1/recruitment');
const r = recruitmentModule.route;

/* Jobs */
r(
  {
    method: 'get',
    path: '/jobs',
    summary: 'List job openings with candidate counts per stage',
    description: 'Requires `recruitment:read`; hiring managers see the jobs they manage.',
    query: paginationQuery.extend({ status: z.enum(JOB_STATUS).optional(), departmentId: optionalObjectId, hiringManagerId: optionalObjectId }),
  },
  c.listJobs,
);
r({ method: 'get', path: '/jobs/:id', summary: 'Get a job opening', params: idParam }, c.getJob);
r({ method: 'post', path: '/jobs', summary: 'Create a job opening', permissions: ['recruitment:create'], body: jobOpeningSchema }, c.createJob);
r({ method: 'patch', path: '/jobs/:id', summary: 'Update a job opening', permissions: ['recruitment:update'], params: idParam, body: jobOpeningUpdateSchema }, c.updateJob);
r(
  { method: 'post', path: '/jobs/:id/status', summary: 'Change job status (DRAFT/OPEN/ON_HOLD/CLOSED)', permissions: ['recruitment:update'], params: idParam, body: jobStatusSchema },
  c.setJobStatus,
);
r(
  {
    method: 'delete',
    path: '/jobs/:id',
    summary: 'Delete a job opening (closed instead when it has candidates)',
    permissions: ['recruitment:update'],
    params: idParam,
  },
  c.removeJob,
);

/* Pipeline */
r({ method: 'get', path: '/pipeline', summary: 'Candidates grouped by stage (kanban)', query: z.object({ jobId: optionalObjectId }) }, c.pipeline);

/* Candidates */
r(
  {
    method: 'get',
    path: '/candidates',
    summary: 'List candidates',
    description: 'Search matches name, email and skills.',
    query: paginationQuery.extend({
      jobId: optionalObjectId,
      stage: z.enum(CANDIDATE_STAGES).optional(),
      source: z.enum(CANDIDATE_SOURCES).optional(),
    }),
  },
  c.listCandidates,
);
r({ method: 'get', path: '/candidates/:id', summary: 'Get a candidate with interviews and stage history', params: idParam }, c.getCandidate);
r({ method: 'post', path: '/candidates', summary: 'Add a candidate to an open job', permissions: ['recruitment:create'], body: candidateSchema }, c.createCandidate);
r(
  { method: 'patch', path: '/candidates/:id', summary: 'Update a candidate', permissions: ['recruitment:update'], params: idParam, body: candidateUpdateSchema },
  c.updateCandidate,
);
r(
  {
    method: 'post',
    path: '/candidates/:id/stage',
    summary: 'Move a candidate to another pipeline stage',
    description: 'Validated by CANDIDATE_PIPELINE; HIRED only via the hire endpoint; rejection requires a reason.',
    permissions: ['recruitment:update'],
    params: idParam,
    body: candidateStageSchema,
  },
  c.moveStage,
);
r(
  {
    method: 'get',
    path: '/candidates/:id/hire-prefill',
    summary: 'Employee pre-fill data for hiring a candidate',
    permissions: ['recruitment:update', 'employee:create'],
    params: idParam,
  },
  c.hirePrefill,
);
r(
  {
    method: 'post',
    path: '/candidates/:id/hire',
    summary: 'Hire an offered candidate (creates employee, user account and onboarding)',
    permissions: ['recruitment:update', 'employee:create'],
    params: idParam,
    body: hireCandidateSchema,
  },
  c.hire,
);

/* Interviews */
r(
  {
    method: 'get',
    path: '/interviews',
    summary: 'List interviews',
    description: 'Interviewers without `recruitment:read` see only their own interviews. `interviewerId=me` filters to the caller.',
    query: paginationQuery.extend({
      candidateId: optionalObjectId,
      jobId: optionalObjectId,
      interviewerId: z.union([z.literal('me'), objectId]).optional(),
      status: z.enum(INTERVIEW_STATUS).optional(),
      from: optionalDateString,
      to: optionalDateString,
    }),
  },
  c.listInterviews,
);
r({ method: 'get', path: '/interviews/:id', summary: 'Get an interview', params: idParam }, c.getInterview);
r({ method: 'post', path: '/interviews', summary: 'Schedule an interview', permissions: ['recruitment:update'], body: interviewSchema }, c.scheduleInterview);
r(
  { method: 'patch', path: '/interviews/:id', summary: 'Reschedule / edit a scheduled interview', permissions: ['recruitment:update'], params: idParam, body: interviewUpdateSchema },
  c.updateInterview,
);
r(
  { method: 'post', path: '/interviews/:id/status', summary: 'Complete, cancel or mark no-show', permissions: ['recruitment:update'], params: idParam, body: interviewStatusSchema },
  c.interviewStatus,
);
r({ method: 'post', path: '/interviews/:id/feedback', summary: 'Submit interviewer feedback', params: idParam, body: interviewFeedbackSchema }, c.interviewFeedback);

/* Dashboard */
r({ method: 'get', path: '/summary', summary: 'Recruitment dashboard summary', permissions: ['recruitment:read'] }, c.summary);
r({ method: 'get', path: '/referrals/summary', summary: 'Employee referrals: counts, latest and top referrer', permissions: ['recruitment:read'] }, c.referrals);
