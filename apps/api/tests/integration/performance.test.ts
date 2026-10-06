import { beforeAll, describe, expect, it } from 'vitest';
import { EmployeeModel, NotificationModel, PerformanceReviewModel } from '../../src/models';
import { as, createEmployeeUser, registerOrg } from '../helpers';

type Emp = Awaited<ReturnType<typeof createEmployeeUser>>;

describe('Performance: cycles, goals, reviews, feedback', () => {
  let admin: Awaited<ReturnType<typeof registerOrg>>;
  let manager: Emp;
  let report: Emp;
  let outsider: Emp;
  let peer: Emp;
  let cycleId: string;
  let managerGoalId: string;
  let selfGoalId: string;
  let reviewId: string;

  beforeAll(async () => {
    admin = await registerOrg();
    manager = await createEmployeeUser(admin.token, { firstName: 'Manny', roles: ['manager'] });
    report = await createEmployeeUser(admin.token, { firstName: 'Rita', managerId: manager.employee._id });
    outsider = await createEmployeeUser(admin.token, { firstName: 'Otto' });
    peer = await createEmployeeUser(admin.token, { firstName: 'Pia' });
  });

  it('manages cycles with permission checks and a validated rating scale', async () => {
    expect((await as(report.token).post('/api/v1/performance/cycles', { name: 'X', startDate: '2026-01-01', endDate: '2026-12-31' })).status).toBe(403);
    const badScale = await as(admin.token).post('/api/v1/performance/cycles', {
      name: 'Bad',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      ratingScale: { min: 5, max: 1, labels: [] },
    });
    expect(badScale.status).toBe(400);
    const badLabels = await as(admin.token).post('/api/v1/performance/cycles', {
      name: 'Bad',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      ratingScale: { min: 1, max: 5, labels: [{ value: 9, label: 'Nine' }] },
    });
    expect(badLabels.status).toBe(400);

    const res = await as(admin.token).post('/api/v1/performance/cycles', { name: 'FY26', startDate: '2026-01-01', endDate: '2026-12-31', goalWeightage: 60 });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.ratingScale.labels).toHaveLength(5);
    cycleId = res.body.data._id;

    // Every authenticated user can see cycles.
    const list = await as(report.token).get('/api/v1/performance/cycles');
    expect(list.status).toBe(200);
    expect(list.body.data.some((c: { _id: string }) => c._id === cycleId)).toBe(true);

    // PATCH keeps omitted fields (no default reset).
    const upd = await as(admin.token).patch(`/api/v1/performance/cycles/${cycleId}`, { description: 'Annual cycle' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.goalWeightage).toBe(60);

    // Employees cannot advance; invalid explicit transition → 422.
    expect((await as(report.token).post(`/api/v1/performance/cycles/${cycleId}/advance`, {})).status).toBe(403);
    expect((await as(admin.token).post(`/api/v1/performance/cycles/${cycleId}/advance`, { status: 'COMPLETED' })).status).toBe(422);
    const adv = await as(admin.token).post(`/api/v1/performance/cycles/${cycleId}/advance`, {});
    expect(adv.status).toBe(200);
    expect(adv.body.data.status).toBe('GOAL_SETTING');
  });

  it('lets managers set goals for reports only, and employees for themselves', async () => {
    const forReport = await as(manager.token).post('/api/v1/performance/goals', {
      title: 'Ship v2',
      category: 'OKR',
      weight: 60,
      employeeId: report.employee._id,
      cycleId,
      dueDate: '2026-06-30',
    });
    expect(forReport.status).toBe(201);
    expect(forReport.body.data.managerId).toBe(manager.employee._id);
    managerGoalId = forReport.body.data._id;
    const reportUser = await EmployeeModel.findById(report.employee._id).select('userId').lean();
    expect(await NotificationModel.countDocuments({ userId: reportUser?.userId, type: 'GOAL' })).toBeGreaterThan(0);

    const forOutsider = await as(manager.token).post('/api/v1/performance/goals', { title: 'Nope', employeeId: outsider.employee._id, cycleId });
    expect(forOutsider.status).toBe(403);
    const employeeForOther = await as(report.token).post('/api/v1/performance/goals', { title: 'Nope', employeeId: peer.employee._id });
    expect(employeeForOther.status).toBe(403);

    const own = await as(report.token).post('/api/v1/performance/goals', { title: 'Learn Rust', category: 'DEVELOPMENT', weight: 40, employeeId: report.employee._id, cycleId });
    expect(own.status).toBe(201);
    selfGoalId = own.body.data._id;

    // Total weight per employee per cycle cannot exceed 100%.
    const over = await as(manager.token).post('/api/v1/performance/goals', { title: 'Too much', weight: 10, employeeId: report.employee._id, cycleId });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('WEIGHT_EXCEEDED');

    // Scoped lists.
    const mine = await as(report.token).get('/api/v1/performance/goals');
    expect(mine.body.data.every((g: { employeeId: { _id: string } }) => g.employeeId._id === report.employee._id)).toBe(true);
    expect(mine.body.data).toHaveLength(2);
    const otherView = await as(outsider.token).get(`/api/v1/performance/goals/${managerGoalId}`);
    expect(otherView.status).toBe(403);
    const teamView = await as(manager.token).get(`/api/v1/performance/goals?employeeId=${report.employee._id}`);
    expect(teamView.body.data).toHaveLength(2);
  });

  it('tracks goal progress with auto-completion and manager-only reopen', async () => {
    const p1 = await as(report.token).post(`/api/v1/performance/goals/${selfGoalId}/progress`, { progress: 50, note: 'Halfway' });
    expect(p1.status).toBe(200);
    expect(p1.body.data.status).toBe('IN_PROGRESS');
    expect(p1.body.data.updates).toHaveLength(1);

    const done = await as(report.token).post(`/api/v1/performance/goals/${selfGoalId}/progress`, { progress: 100 });
    expect(done.body.data.status).toBe('COMPLETED');

    expect((await as(report.token).post(`/api/v1/performance/goals/${selfGoalId}/progress`, { progress: 90 })).status).toBe(422);
    expect((await as(outsider.token).post(`/api/v1/performance/goals/${selfGoalId}/progress`, { progress: 10 })).status).toBe(403);
    // Employees cannot cancel or delete.
    expect((await as(report.token).post(`/api/v1/performance/goals/${managerGoalId}/progress`, { progress: 10, status: 'CANCELLED' })).status).toBe(403);
    expect((await as(report.token).delete(`/api/v1/performance/goals/${managerGoalId}`)).status).toBe(403);

    const reopen = await as(manager.token).post(`/api/v1/performance/goals/${selfGoalId}/progress`, { progress: 80, status: 'IN_PROGRESS', note: 'Reopened' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.status).toBe('IN_PROGRESS');
    expect(reopen.body.data.progress).toBe(80);
    expect(reopen.body.data.updates).toHaveLength(3);
  });

  it('creates reviews for all active employees when the cycle reaches self review (idempotent)', async () => {
    await as(admin.token).post(`/api/v1/performance/cycles/${cycleId}/advance`, {});
    const adv = await as(admin.token).post(`/api/v1/performance/cycles/${cycleId}/advance`, {});
    expect(adv.status).toBe(200);
    expect(adv.body.data.status).toBe('SELF_REVIEW');

    const orgId = admin.user.organization._id;
    const active = await EmployeeModel.countDocuments({ organizationId: orgId, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } });
    expect(adv.body.data.reviewsCreated).toBe(active);
    expect(await PerformanceReviewModel.countDocuments({ cycleId })).toBe(active);

    const again = await as(admin.token).post(`/api/v1/performance/cycles/${cycleId}/generate-reviews`, {});
    expect(again.status).toBe(200);
    expect(again.body.data.created).toBe(0);

    const review = await PerformanceReviewModel.findOne({ cycleId, employeeId: report.employee._id }).lean();
    expect(review?.status).toBe('PENDING_SELF');
    expect(String(review?.managerId)).toBe(manager.employee._id);
    reviewId = String(review!._id);
  });

  it('runs self → manager → HR review with scale checks, hidden sections and final rating math', async () => {
    const outOfScale = await as(report.token).post(`/api/v1/performance/reviews/${reviewId}/self`, { overallRating: 7 });
    expect(outOfScale.status).toBe(400);
    expect(outOfScale.body.code).toBe('RATING_OUT_OF_SCALE');
    // Only the employee writes the self review; manager can't skip ahead.
    expect((await as(manager.token).post(`/api/v1/performance/reviews/${reviewId}/self`, { overallRating: 3 })).status).toBe(403);
    expect((await as(manager.token).post(`/api/v1/performance/reviews/${reviewId}/manager`, { overallRating: 3 })).status).toBe(422);

    const self = await as(report.token).post(`/api/v1/performance/reviews/${reviewId}/self`, {
      overallRating: 5,
      strengths: 'Delivery',
      ratings: [{ goalId: managerGoalId, rating: 5 }],
    });
    expect(self.status).toBe(200);
    expect(self.body.data.status).toBe('PENDING_MANAGER');

    expect((await as(outsider.token).get(`/api/v1/performance/reviews/${reviewId}`)).status).toBe(403);
    expect((await as(report.token).post(`/api/v1/performance/reviews/${reviewId}/manager`, { overallRating: 5 })).status).toBe(403);
    expect((await as(manager.token).post(`/api/v1/performance/reviews/${reviewId}/manager`, { overallRating: 6 })).status).toBe(400);

    const mgr = await as(manager.token).post(`/api/v1/performance/reviews/${reviewId}/manager`, {
      overallRating: 4,
      comments: 'Solid year',
      ratings: [{ goalId: managerGoalId, rating: 4 }],
    });
    expect(mgr.status).toBe(200);
    expect(mgr.body.data.status).toBe('PENDING_HR');

    // Employee cannot see the manager section before completion; the manager can.
    const hidden = await as(report.token).get(`/api/v1/performance/reviews/${reviewId}`);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data.selfReview.overallRating).toBe(5);
    expect(hidden.body.data.managerReview).toBeNull();
    const listHidden = await as(report.token).get(`/api/v1/performance/reviews?cycleId=${cycleId}`);
    expect(listHidden.body.data[0].managerReview).toBeNull();
    const mgrView = await as(manager.token).get(`/api/v1/performance/reviews/${reviewId}`);
    expect(mgrView.body.data.managerReview.overallRating).toBe(4);

    // Only performance:review holders finalize.
    expect((await as(manager.token).post(`/api/v1/performance/reviews/${reviewId}/hr`, {})).status).toBe(403);
    const hr = await as(admin.token).post(`/api/v1/performance/reviews/${reviewId}/hr`, { comments: 'Agreed' });
    expect(hr.status).toBe(200);
    expect(hr.body.data.status).toBe('COMPLETED');
    // Goal A (60%) rated 4 by manager, goal B (40%) at 80% progress → 4.2 ⇒ goal score 4.08.
    // Final = 60% × 4.08 + 40% × 4 = 4.048 → 4.05.
    expect(hr.body.data.goalScore).toBe(4.08);
    expect(hr.body.data.finalRating).toBe(4.05);
    expect(hr.body.data.finalRatingLabel).toBe('Exceeds expectations');

    const visible = await as(report.token).get(`/api/v1/performance/reviews/${reviewId}`);
    expect(visible.body.data.managerReview.overallRating).toBe(4);
    expect(visible.body.data.finalRating).toBe(4.05);
    expect((await as(admin.token).post(`/api/v1/performance/reviews/${reviewId}/hr`, {})).status).toBe(422);
  });

  it('applies an HR override of the overall rating', async () => {
    const review = await PerformanceReviewModel.findOne({ cycleId, employeeId: peer.employee._id }).lean();
    const id = String(review!._id);
    expect((await as(peer.token).post(`/api/v1/performance/reviews/${id}/self`, { overallRating: 3 })).status).toBe(200);
    // Peer has no manager → HR writes the manager section.
    expect((await as(admin.token).post(`/api/v1/performance/reviews/${id}/manager`, { overallRating: 3 })).status).toBe(200);
    const hr = await as(admin.token).post(`/api/v1/performance/reviews/${id}/hr`, { overallRating: 2 });
    expect(hr.status).toBe(200);
    // No goals → overall rating counts 100%.
    expect(hr.body.data.goalScore).toBeNull();
    expect(hr.body.data.finalRating).toBe(2);
    expect(hr.body.data.finalRatingLabel).toBe('Below expectations');
  });

  it('enforces feedback visibility', async () => {
    expect((await as(report.token).post('/api/v1/performance/feedback', { employeeId: report.employee._id, message: 'Me!' })).status).toBe(400);
    for (const visibility of ['PRIVATE', 'MANAGER', 'PUBLIC']) {
      const r = await as(outsider.token).post('/api/v1/performance/feedback', { employeeId: report.employee._id, message: `${visibility} note`, visibility });
      expect(r.status).toBe(201);
    }
    const url = `/api/v1/performance/feedback?employeeId=${report.employee._id}`;
    expect((await as(report.token).get('/api/v1/performance/feedback')).body.data).toHaveLength(3);
    expect((await as(admin.token).get(url)).body.data).toHaveLength(3);
    const mgr = await as(manager.token).get(url);
    expect(mgr.body.data.map((f: { visibility: string }) => f.visibility).sort()).toEqual(['MANAGER', 'PUBLIC']);
    const other = await as(peer.token).get(url);
    expect(other.body.data.map((f: { visibility: string }) => f.visibility)).toEqual(['PUBLIC']);
    // Authors see what they wrote.
    expect((await as(outsider.token).get(url)).body.data).toHaveLength(3);
    expect((await as(outsider.token).get('/api/v1/performance/feedback?given=true')).body.data).toHaveLength(3);
  });

  it('serves a dashboard summary to HR and managers only', async () => {
    const s = await as(admin.token).get(`/api/v1/performance/summary?cycleId=${cycleId}`);
    expect(s.status).toBe(200);
    expect(s.body.data.reviews.byStatus.COMPLETED).toBe(2);
    expect(s.body.data.ratingDistribution.find((d: { value: number }) => d.value === 4).count).toBe(1);
    expect(s.body.data.goals.total).toBe(2);
    expect(s.body.data.goals.averageProgress).toBe(40);
    const m = await as(manager.token).get(`/api/v1/performance/summary?cycleId=${cycleId}`);
    expect(m.status).toBe(200);
    expect(m.body.data.reviews.total).toBe(1);
    expect((await as(report.token).get('/api/v1/performance/summary')).status).toBe(403);
  });

  it('opens the org-wide summary to performance:review / performance:create holders', async () => {
    for (const permissions of [['performance:review'], ['performance:create']]) {
      const role = await as(admin.token).post('/api/v1/roles', { name: `Perf ${permissions[0]} ${Date.now()}`, permissions });
      expect(role.status).toBe(201);
      const hr = await createEmployeeUser(admin.token, { firstName: 'Hana', roleIds: [role.body.data._id] });
      const s = await as(hr.token).get(`/api/v1/performance/summary?cycleId=${cycleId}`);
      expect(s.status).toBe(200);
      // Org-wide, not limited to (empty) team scope.
      expect(s.body.data.reviews.byStatus.COMPLETED).toBe(2);
    }
  });

  it('returns competencies and due dates on the review cycle, and clears cycle due dates via PATCH', async () => {
    const upd = await as(admin.token).patch(`/api/v1/performance/cycles/${cycleId}`, {
      competencies: ['Communication', 'Ownership'],
      selfReviewDue: '2026-03-31',
      managerReviewDue: '2026-04-30',
    });
    expect(upd.status).toBe(200);

    const review = await as(manager.token).get(`/api/v1/performance/reviews/${reviewId}`);
    expect(review.status).toBe(200);
    expect(review.body.data.cycleId).toMatchObject({
      name: 'FY26',
      goalWeightage: 60,
      competencies: ['Communication', 'Ownership'],
      selfReviewDue: '2026-03-31T00:00:00.000Z',
      managerReviewDue: '2026-04-30T00:00:00.000Z',
    });
    expect(review.body.data.cycleId.status).toBeTruthy();
    expect(review.body.data.cycleId.ratingScale.labels).toHaveLength(5);
    const list = await as(manager.token).get(`/api/v1/performance/reviews?cycleId=${cycleId}`);
    expect(list.body.data[0].cycleId.competencies).toEqual(['Communication', 'Ownership']);

    const cleared = await as(admin.token).patch(`/api/v1/performance/cycles/${cycleId}`, { selfReviewDue: null, managerReviewDue: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.selfReviewDue ?? null).toBeNull();
    expect(cleared.body.data.managerReviewDue ?? null).toBeNull();
    expect(cleared.body.data.competencies).toEqual(['Communication', 'Ownership']);
    // Required fields cannot be cleared.
    expect((await as(admin.token).patch(`/api/v1/performance/cycles/${cycleId}`, { name: null })).status).toBe(400);
  });

  it('clears goal due date and cycle via PATCH', async () => {
    const created = await as(manager.token).post('/api/v1/performance/goals', {
      title: 'Mentor a junior',
      employeeId: report.employee._id,
      cycleId,
      dueDate: '2026-09-30',
    });
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;

    const noDue = await as(manager.token).patch(`/api/v1/performance/goals/${id}`, { dueDate: null });
    expect(noDue.status).toBe(200);
    expect(noDue.body.data.dueDate ?? null).toBeNull();
    expect(noDue.body.data.cycleId).toBe(cycleId);

    const noCycle = await as(manager.token).patch(`/api/v1/performance/goals/${id}`, { cycleId: null });
    expect(noCycle.status).toBe(200);
    expect(noCycle.body.data.cycleId ?? null).toBeNull();

    await as(manager.token).patch(`/api/v1/performance/goals/${id}`, { dueDate: '2026-10-31' });
    const blank = await as(manager.token).patch(`/api/v1/performance/goals/${id}`, { dueDate: '' });
    expect(blank.body.data.dueDate ?? null).toBeNull();
    expect((await as(manager.token).patch(`/api/v1/performance/goals/${id}`, { title: null })).status).toBe(400);
    await as(manager.token).delete(`/api/v1/performance/goals/${id}`);
  });

  it('names the author of each goal update', async () => {
    const goal = await as(report.token).get(`/api/v1/performance/goals/${selfGoalId}`);
    expect(goal.status).toBe(200);
    const names = goal.body.data.updates.map((u: { byName: string | null }) => u.byName);
    expect(names).toEqual(['Rita Person', 'Rita Person', 'Manny Person']);
    const list = await as(report.token).get('/api/v1/performance/goals');
    const listed = list.body.data.find((g: { _id: string }) => g._id === selfGoalId);
    expect(listed.updates[2].byName).toBe('Manny Person');
  });

  it('isolates tenants', async () => {
    const other = await registerOrg();
    expect((await as(other.token).get(`/api/v1/performance/reviews/${reviewId}`)).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/performance/goals/${managerGoalId}`)).status).toBe(404);
    expect((await as(other.token).get(`/api/v1/performance/cycles/${cycleId}`)).status).toBe(404);
    expect((await as(other.token).post(`/api/v1/performance/cycles/${cycleId}/advance`, {})).status).toBe(404);
    expect((await as(other.token).post('/api/v1/performance/goals', { title: 'X', employeeId: report.employee._id })).status).toBe(400);
    const list = await as(other.token).get('/api/v1/performance/cycles');
    expect(list.body.data).toHaveLength(0);
  });
});
