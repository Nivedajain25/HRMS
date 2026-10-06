import { lazy } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const JobsPage = lazy(() => import('./jobs-page').then((m) => ({ default: m.JobsPage })));
const JobDetailPage = lazy(() => import('./job-detail-page').then((m) => ({ default: m.JobDetailPage })));
const CandidatesPage = lazy(() => import('./candidates-page').then((m) => ({ default: m.CandidatesPage })));
const CandidateProfilePage = lazy(() => import('./candidate-profile-page').then((m) => ({ default: m.CandidateProfilePage })));
const InterviewsPage = lazy(() => import('./interviews-page').then((m) => ({ default: m.InterviewsPage })));

/**
 * Jobs and candidates: recruiters (`recruitment:read`) and hiring managers.
 * Interviews: also any employee, because assigned interviewers without
 * recruitment access see (and give feedback on) their own interviews.
 * The API enforces the exact scope in every case.
 */
export const routes: RouteObject[] = [
  { path: '/recruitment', element: <Navigate to="/recruitment/jobs" replace /> },
  { path: '/recruitment/jobs', element: <RequirePermission any={['recruitment:read']} manager><JobsPage /></RequirePermission> },
  { path: '/recruitment/jobs/:id', element: <RequirePermission any={['recruitment:read']} manager><JobDetailPage /></RequirePermission> },
  { path: '/recruitment/candidates', element: <RequirePermission any={['recruitment:read']} manager><CandidatesPage /></RequirePermission> },
  { path: '/recruitment/candidates/:id', element: <RequirePermission any={['recruitment:read']} manager><CandidateProfilePage /></RequirePermission> },
  { path: '/recruitment/interviews/:id?', element: <RequirePermission any={['recruitment:read']} manager employee><InterviewsPage /></RequirePermission> },
];
