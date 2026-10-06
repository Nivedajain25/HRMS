import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const SalaryPages = () => import('./salary-pages');
const SalaryListPage = lazy(() => SalaryPages().then((m) => ({ default: m.SalaryListPage })));
const SalaryComponentsPage = lazy(() => SalaryPages().then((m) => ({ default: m.SalaryComponentsPage })));
const SalaryDetailPage = lazy(() => SalaryPages().then((m) => ({ default: m.SalaryDetailPage })));
const PayrollPages = () => import('./payroll-pages');
const PayrollListPage = lazy(() => PayrollPages().then((m) => ({ default: m.PayrollListPage })));
const PayrollRunPage = lazy(() => PayrollPages().then((m) => ({ default: m.PayrollRunPage })));
const PayslipsPage = lazy(() => import('./payslips-page').then((m) => ({ default: m.PayslipsPage })));

export const routes: RouteObject[] = [
  { path: '/salary', element: <RequirePermission any={['salary:read']}><SalaryListPage /></RequirePermission> },
  { path: '/salary/components', element: <RequirePermission any={['salary:read']}><SalaryComponentsPage /></RequirePermission> },
  { path: '/salary/:employeeId', element: <RequirePermission any={['salary:read']}><SalaryDetailPage /></RequirePermission> },
  { path: '/payroll', element: <RequirePermission any={['payroll:read']}><PayrollListPage /></RequirePermission> },
  { path: '/payroll/:id', element: <RequirePermission any={['payroll:read']}><PayrollRunPage /></RequirePermission> },
  { path: '/payslips', element: <PayslipsPage /> },
  { path: '/payslips/:id', element: <PayslipsPage /> },
];
