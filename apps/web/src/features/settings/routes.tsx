import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';

const SettingsPage = lazy(() => import('./settings-page').then((m) => ({ default: m.SettingsPage })));

export const routes: RouteObject[] = [
  { path: '/settings', element: <SettingsPage /> },
  { path: '/settings/:section', element: <SettingsPage /> },
];
