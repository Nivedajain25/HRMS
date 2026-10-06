import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const ComplaintsPage = lazy(() => import('./complaints-page').then((m) => ({ default: m.ComplaintsPage })));
const ComplaintDetailPage = lazy(() => import('./complaint-detail-page').then((m) => ({ default: m.ComplaintDetailPage })));

// Everyone signed in (reached from My Account); the API limits what each person sees.
export const routes: RouteObject[] = [
  { path: '/complaints', element: <ComplaintsPage /> },
  { path: '/complaints/:id', element: <ComplaintDetailPage /> },
];
