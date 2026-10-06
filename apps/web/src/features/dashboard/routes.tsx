import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const DashboardPage = lazy(() => import('./dashboard-page').then((m) => ({ default: m.DashboardPage })));

const TeamPage = lazy(() => import('./team-page').then((m) => ({ default: m.TeamPage })));

export const routes: RouteObject[] = [
  { path: '/', element: <DashboardPage /> },
  { path: '/team', element: <TeamPage /> },
];
