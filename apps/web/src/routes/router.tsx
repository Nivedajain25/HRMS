import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
import { ErrorBoundary, NotFoundPage, RouteError } from '@/app/error-boundary';
import {
  AcceptInvitePage,
  ChangePasswordPage,
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/features/auth/pages';
import { routes as announcementRoutes } from '@/features/announcements/routes';
import { routes as assetRoutes } from '@/features/assets/routes';
import { routes as attendanceRoutes } from '@/features/attendance/routes';
import { routes as dashboardRoutes } from '@/features/dashboard/routes';
import { routes as documentRoutes } from '@/features/documents/routes';
import { routes as emergencyRoutes } from '@/features/emergencies/routes';
import { routes as employeeRoutes } from '@/features/employees/routes';
import { routes as expenseRoutes } from '@/features/expenses/routes';
import { routes as leaveRoutes } from '@/features/leave/routes';
import { routes as lifecycleRoutes } from '@/features/onboarding/routes';
import { routes as notificationRoutes } from '@/features/notifications/routes';
import { routes as payrollRoutes } from '@/features/payroll/routes';
import { routes as performanceRoutes } from '@/features/performance/routes';
import { routes as recruitmentRoutes } from '@/features/recruitment/routes';
import { routes as reportRoutes } from '@/features/reports/routes';
import { routes as salesRoutes } from '@/features/sales/routes';
import { routes as helpRoutes } from '@/features/help/routes';
import { routes as incentiveRoutes } from '@/features/incentives/routes';
import { routes as accountRoutes } from '@/features/account/routes';
import { routes as complaintRoutes } from '@/features/complaints/routes';
import { routes as loanRoutes } from '@/features/loans/routes';
import { routes as learningRoutes } from '@/features/learning/routes';
import { routes as travelRoutes } from '@/features/travel/routes';
import { routes as settingsRoutes } from '@/features/settings/routes';
import { routes as taskRoutes } from '@/features/tasks/routes';
import { AppLayout } from '@/layouts/app-layout';
import { GuestOnly, RequireAuth } from './guards';

/** Wraps each page in an error boundary so failures stay local. */
const withBoundary = (routes: RouteObject[]): RouteObject[] =>
  routes.map((r) => ({
    ...r,
    element: r.element ? <ErrorBoundary>{r.element}</ErrorBoundary> : r.element,
    children: r.children ? withBoundary(r.children) : undefined,
  })) as RouteObject[];

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      // Token links work whether or not someone is signed in.
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/accept-invite', element: <AcceptInvitePage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              ...withBoundary([
                ...dashboardRoutes,
                ...employeeRoutes,
                ...lifecycleRoutes,
                ...attendanceRoutes,
                ...leaveRoutes,
                ...payrollRoutes,
                ...performanceRoutes,
                ...recruitmentRoutes,
                ...expenseRoutes,
                ...assetRoutes,
                ...documentRoutes,
                ...taskRoutes,
                ...announcementRoutes,
                ...notificationRoutes,
                ...emergencyRoutes,
                ...salesRoutes,
                ...helpRoutes,
                ...incentiveRoutes,
                ...accountRoutes,
                ...complaintRoutes,
                ...loanRoutes,
                ...learningRoutes,
                ...travelRoutes,
                ...reportRoutes,
                ...settingsRoutes,
                { path: '/change-password', element: <ChangePasswordPage /> },
              ]),
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Outlet /> },
]);
