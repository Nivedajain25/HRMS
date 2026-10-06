import type { Request } from 'express';
import type { PaginationQuery } from '@stencil/shared';
import { body, query } from '../middleware/validate';
import * as goals from '../services/goal.service';
import * as perf from '../services/performance.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type Q = PaginationQuery & Record<string, string | undefined>;
const q = (req: Request) => query<Q>(req);

export const performanceController = {
  // Cycles
  listCycles: handlePaged((ctx, req) => perf.listCycles(ctx, q(req))),
  getCycle: handle((ctx, req) => perf.getCycle(ctx, idOf(req))),
  createCycle: handleCreated((ctx, req) => perf.createCycle(ctx, body(req)), 'Performance cycle created'),
  updateCycle: handle((ctx, req) => perf.updateCycle(ctx, idOf(req), body(req)), 'Performance cycle updated'),
  removeCycle: handle((ctx, req) => perf.removeCycle(ctx, idOf(req)), 'Performance cycle deleted'),
  advanceCycle: handle((ctx, req) => perf.advanceCycle(ctx, idOf(req), body(req)), 'Cycle advanced'),
  generateReviews: handle((ctx, req) => perf.regenerateReviews(ctx, idOf(req)), 'Reviews generated'),

  // Goals
  listGoals: handlePaged((ctx, req) => goals.listGoals(ctx, q(req))),
  getGoal: handle((ctx, req) => goals.getGoal(ctx, idOf(req))),
  createGoal: handleCreated((ctx, req) => goals.createGoal(ctx, body(req)), 'Goal created'),
  updateGoal: handle((ctx, req) => goals.updateGoal(ctx, idOf(req), body(req)), 'Goal updated'),
  goalProgress: handle((ctx, req) => goals.updateGoalProgress(ctx, idOf(req), body(req)), 'Progress updated'),
  removeGoal: handle((ctx, req) => goals.removeGoal(ctx, idOf(req)), 'Goal deleted'),

  // Reviews
  listReviews: handlePaged((ctx, req) => perf.listReviews(ctx, q(req))),
  getReview: handle((ctx, req) => perf.getReview(ctx, idOf(req))),
  selfReview: handle((ctx, req) => perf.submitSelfReview(ctx, idOf(req), body(req)), 'Self review submitted'),
  managerReview: handle((ctx, req) => perf.submitManagerReview(ctx, idOf(req), body(req)), 'Manager review submitted'),
  hrReview: handle((ctx, req) => perf.submitHrReview(ctx, idOf(req), body(req)), 'Review completed'),

  // Feedback
  listFeedback: handlePaged((ctx, req) => perf.listFeedback(ctx, query(req))),
  giveFeedback: handleCreated((ctx, req) => perf.giveFeedback(ctx, body(req)), 'Feedback shared'),

  summary: handle((ctx, req) => perf.performanceSummary(ctx, query<{ cycleId?: string }>(req))),
};
