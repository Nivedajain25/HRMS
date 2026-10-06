import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const AttendancePage = lazy(() => import('./attendance-page').then((m) => ({ default: m.AttendancePage })));
const RegularizationPages = () => import('./regularization-page');
const RegularizationPage = lazy(() => RegularizationPages().then((m) => ({ default: m.RegularizationPage })));
const RegularizationRedirect = lazy(() => RegularizationPages().then((m) => ({ default: m.RegularizationRedirect })));
const ShiftsPage = lazy(() => import('./shifts-page').then((m) => ({ default: m.ShiftsPage })));
const HolidaysPage = lazy(() => import('./holidays-page').then((m) => ({ default: m.HolidaysPage })));

export const routes: RouteObject[] = [
  { path: '/attendance', element: <AttendancePage /> },
  { path: '/attendance/regularizations/:id', element: <RegularizationRedirect /> },
  { path: '/regularization', element: <RegularizationPage /> },
  { path: '/shifts', element: <RequirePermission any={['shift:manage', 'attendance:read']}><ShiftsPage /></RequirePermission> },
  { path: '/holidays', element: <HolidaysPage /> },
];
