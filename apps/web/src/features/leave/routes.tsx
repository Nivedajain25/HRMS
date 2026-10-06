import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const LeaveRequestsPage = lazy(() => import('./leave-requests-page').then((m) => ({ default: m.LeaveRequestsPage })));
const LeaveTypesPage = lazy(() => import('./leave-types-page').then((m) => ({ default: m.LeaveTypesPage })));
const LeaveCalendarPage = lazy(() => import('./leave-calendar-page').then((m) => ({ default: m.LeaveCalendarPage })));

export const routes: RouteObject[] = [
  { path: '/leave', element: <LeaveRequestsPage /> },
  // Deep link used by notifications and global search: the requests page with the detail drawer open.
  { path: '/leave/requests/:id', element: <LeaveRequestsPage /> },
  { path: '/leave/types', element: <RequirePermission any={['leave_type:manage']}><LeaveTypesPage /></RequirePermission> },
  { path: '/leave/calendar', element: <LeaveCalendarPage /> },
];
