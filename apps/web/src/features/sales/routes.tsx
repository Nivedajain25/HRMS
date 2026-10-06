import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const SalesPage = lazy(() => import('./sales-page').then((m) => ({ default: m.SalesPage })));

export const routes: RouteObject[] = [
  // Everyone signed in: employees get My sales; report:read / employee:read also get the company and team figures.
  { path: '/sales', element: <SalesPage /> },
];
