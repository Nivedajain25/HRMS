import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const EmployeeListPage = lazy(() => import('./employee-list-page').then((m) => ({ default: m.EmployeeListPage })));
const EmployeeProfilePage = lazy(() => import('./employee-profile-page').then((m) => ({ default: m.EmployeeProfilePage })));
const MyProfilePage = lazy(() => import('./my-profile-page').then((m) => ({ default: m.MyProfilePage })));
const OrgPages = () => import('./org-structure-pages');
const DepartmentsPage = lazy(() => OrgPages().then((m) => ({ default: m.DepartmentsPage })));
const DesignationsPage = lazy(() => OrgPages().then((m) => ({ default: m.DesignationsPage })));
const LocationsPage = lazy(() => OrgPages().then((m) => ({ default: m.LocationsPage })));
const OrgChartPage = lazy(() => OrgPages().then((m) => ({ default: m.OrgChartPage })));

export const routes: RouteObject[] = [
  { path: '/employees', element: <RequirePermission any={['employee:read']} manager><EmployeeListPage /></RequirePermission> },
  { path: '/employees/org-chart', element: <OrgChartPage /> },
  { path: '/employees/:id', element: <EmployeeProfilePage /> },
  { path: '/profile', element: <MyProfilePage /> },
  { path: '/departments', element: <RequirePermission any={['employee:read', 'department:manage']}><DepartmentsPage /></RequirePermission> },
  { path: '/designations', element: <RequirePermission any={['employee:read', 'designation:manage']}><DesignationsPage /></RequirePermission> },
  { path: '/locations', element: <RequirePermission any={['employee:read', 'location:manage']}><LocationsPage /></RequirePermission> },
];
