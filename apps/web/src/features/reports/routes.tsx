import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const ReportsPage = lazy(() => import('./reports-page').then((m) => ({ default: m.ReportsPage })));
const ReportViewerPage = lazy(() => import('./report-viewer-page').then((m) => ({ default: m.ReportViewerPage })));

export const routes: RouteObject[] = [
  { path: '/reports', element: <RequirePermission any={['report:read']}><ReportsPage /></RequirePermission> },
  { path: '/reports/:type', element: <RequirePermission any={['report:read']}><ReportViewerPage /></RequirePermission> },
];
