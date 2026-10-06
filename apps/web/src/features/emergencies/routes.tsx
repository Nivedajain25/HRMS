import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const EmergenciesPage = lazy(() => import('./emergencies-page').then((m) => ({ default: m.EmergenciesPage })));
const EmergencyDetailPage = lazy(() => import('./emergency-detail-page').then((m) => ({ default: m.EmergencyDetailPage })));

export const routes: RouteObject[] = [
  { path: '/emergencies', element: <EmergenciesPage /> },
  { path: '/emergencies/:id', element: <EmergencyDetailPage /> },
];
