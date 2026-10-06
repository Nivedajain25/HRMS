import { lazy } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const GoalsPage = lazy(() => import('./goals-page').then((m) => ({ default: m.GoalsPage })));
const GoalDetailPage = lazy(() => import('./goal-detail-page').then((m) => ({ default: m.GoalDetailPage })));
const ReviewsPage = lazy(() => import('./reviews-page').then((m) => ({ default: m.ReviewsPage })));
const ReviewDetailPage = lazy(() => import('./review-detail-page').then((m) => ({ default: m.ReviewDetailPage })));
const FeedbackPage = lazy(() => import('./feedback-page').then((m) => ({ default: m.FeedbackPage })));
const CyclePages = () => import('./cycles-page');
const CyclesPage = lazy(() => CyclePages().then((m) => ({ default: m.CyclesPage })));
const CycleDetailPage = lazy(() => CyclePages().then((m) => ({ default: m.CycleDetailPage })));

const cycleAccess = ['performance:create', 'performance:review'] as const;

export const routes: RouteObject[] = [
  { path: '/performance', element: <Navigate to="/performance/goals" replace /> },
  { path: '/performance/goals', element: <GoalsPage /> },
  { path: '/performance/goals/:id', element: <GoalDetailPage /> },
  { path: '/performance/reviews', element: <ReviewsPage /> },
  { path: '/performance/reviews/:id', element: <ReviewDetailPage /> },
  { path: '/performance/feedback', element: <FeedbackPage /> },
  { path: '/performance/cycles', element: <RequirePermission any={[...cycleAccess]}><CyclesPage /></RequirePermission> },
  { path: '/performance/cycles/:id', element: <RequirePermission any={[...cycleAccess]}><CycleDetailPage /></RequirePermission> },
];
