import { z } from 'zod';
import {
  CYCLE_STATUS,
  GOAL_CATEGORIES,
  GOAL_STATUS,
  REVIEW_STATUS,
  cycleAdvanceSchema,
  feedbackSchema,
  goalProgressSchema,
  goalSchema,
  goalUpdateSchema,
  hrReviewSubmitSchema,
  idParam,
  optionalObjectId,
  paginationQuery,
  performanceCycleSchema,
  performanceCycleUpdateSchema,
  reviewSubmitSchema,
} from '@stencil/shared';
import { performanceController as c } from '../controllers/performance.controller';
import { createModule } from './registry';

const scope = z.enum(['me', 'team', 'all']).optional();

export const performanceModule = createModule('Performance', '/api/v1/performance');
const r = performanceModule.route;

/* Cycles */
r({ method: 'get', path: '/cycles', summary: 'List performance cycles', query: paginationQuery.extend({ status: z.enum(CYCLE_STATUS).optional() }) }, c.listCycles);
r({ method: 'get', path: '/cycles/:id', summary: 'Get a performance cycle (with review counts)', params: idParam }, c.getCycle);
r({ method: 'post', path: '/cycles', summary: 'Create a performance cycle', permissions: ['performance:create'], body: performanceCycleSchema }, c.createCycle);
r(
  { method: 'patch', path: '/cycles/:id', summary: 'Update a performance cycle', permissions: ['performance:create'], params: idParam, body: performanceCycleUpdateSchema },
  c.updateCycle,
);
r({ method: 'delete', path: '/cycles/:id', summary: 'Delete a draft cycle', permissions: ['performance:create'], params: idParam }, c.removeCycle);
r(
  {
    method: 'post',
    path: '/cycles/:id/advance',
    summary: 'Advance a cycle to its next stage',
    description: 'Moving to SELF_REVIEW creates a review for every active employee in scope (idempotent).',
    anyPermission: ['performance:review', 'performance:create'],
    params: idParam,
    body: cycleAdvanceSchema,
  },
  c.advanceCycle,
);
r(
  {
    method: 'post',
    path: '/cycles/:id/generate-reviews',
    summary: 'Create missing reviews (e.g. for new joiners) during the review stage',
    anyPermission: ['performance:review', 'performance:create'],
    params: idParam,
  },
  c.generateReviews,
);

/* Goals */
r(
  {
    method: 'get',
    path: '/goals',
    summary: 'List goals (scoped: self / team / all)',
    query: paginationQuery.extend({
      cycleId: optionalObjectId,
      employeeId: optionalObjectId,
      status: z.enum(GOAL_STATUS).optional(),
      category: z.enum(GOAL_CATEGORIES).optional(),
      scope,
    }),
  },
  c.listGoals,
);
r({ method: 'get', path: '/goals/:id', summary: 'Get a goal', params: idParam }, c.getGoal);
r(
  {
    method: 'post',
    path: '/goals',
    summary: 'Create a goal',
    description: 'Managers for their reports, HR for anyone, employees for themselves (during goal setting / in progress, or without a cycle).',
    body: goalSchema,
  },
  c.createGoal,
);
r({ method: 'patch', path: '/goals/:id', summary: 'Edit goal details', params: idParam, body: goalUpdateSchema }, c.updateGoal);
r({ method: 'post', path: '/goals/:id/progress', summary: 'Update goal progress', params: idParam, body: goalProgressSchema }, c.goalProgress);
r({ method: 'delete', path: '/goals/:id', summary: 'Delete a goal (manager / HR)', params: idParam }, c.removeGoal);

/* Reviews */
r(
  {
    method: 'get',
    path: '/reviews',
    summary: 'List performance reviews (scoped)',
    query: paginationQuery.extend({ cycleId: optionalObjectId, employeeId: optionalObjectId, status: z.enum(REVIEW_STATUS).optional(), scope }),
  },
  c.listReviews,
);
r({ method: 'get', path: '/reviews/:id', summary: 'Get a review (manager/HR sections hidden from the employee until completed)', params: idParam }, c.getReview);
r({ method: 'post', path: '/reviews/:id/self', summary: 'Submit self review', params: idParam, body: reviewSubmitSchema }, c.selfReview);
r({ method: 'post', path: '/reviews/:id/manager', summary: 'Submit manager review', params: idParam, body: reviewSubmitSchema }, c.managerReview);
r(
  { method: 'post', path: '/reviews/:id/hr', summary: 'Finalize review (computes final rating)', permissions: ['performance:review'], params: idParam, body: hrReviewSubmitSchema },
  c.hrReview,
);

/* Feedback */
r(
  {
    method: 'get',
    path: '/feedback',
    summary: 'List feedback for an employee (visibility enforced)',
    description: 'Defaults to the caller. `given=true` lists feedback the caller wrote.',
    query: paginationQuery.extend({ employeeId: optionalObjectId, given: z.stringbool().optional() }),
  },
  c.listFeedback,
);
r({ method: 'post', path: '/feedback', summary: 'Give feedback to a colleague', body: feedbackSchema }, c.giveFeedback);

/* Dashboard */
r({ method: 'get', path: '/summary', summary: 'Performance dashboard summary (HR / managers)', query: z.object({ cycleId: optionalObjectId }) }, c.summary);
