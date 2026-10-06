import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const OnboardingListPage = lazy(() => import('./onboarding-list-page').then((m) => ({ default: m.OnboardingListPage })));
const OnboardingDetailPage = lazy(() => import('./onboarding-detail-page').then((m) => ({ default: m.OnboardingDetailPage })));
const OffboardingListPage = lazy(() => import('./offboarding-list-page').then((m) => ({ default: m.OffboardingListPage })));
const OffboardingDetailPage = lazy(() => import('./offboarding-detail-page').then((m) => ({ default: m.OffboardingDetailPage })));

/** Onboarding and offboarding (the API scopes records: HR → all, managers → team, employees → own). */
export const routes: RouteObject[] = [
  { path: '/onboarding', element: <RequirePermission any={['onboarding:manage']} manager employee><OnboardingListPage /></RequirePermission> },
  { path: '/onboarding/:id', element: <RequirePermission any={['onboarding:manage']} manager employee><OnboardingDetailPage /></RequirePermission> },
  { path: '/offboarding', element: <RequirePermission any={['offboarding:manage']} manager employee><OffboardingListPage /></RequirePermission> },
  { path: '/offboarding/:id', element: <RequirePermission any={['offboarding:manage']} manager employee><OffboardingDetailPage /></RequirePermission> },
];
