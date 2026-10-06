import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequirePermission } from '@/routes/guards';

const ExpensesPage = lazy(() => import('./expenses-page').then((m) => ({ default: m.ExpensesPage })));
const ExpenseApprovalsPage = lazy(() => import('./expense-approvals-page').then((m) => ({ default: m.ExpenseApprovalsPage })));

export const routes: RouteObject[] = [
  { path: '/expenses', element: <ExpensesPage /> },
  {
    path: '/expenses/approvals',
    element: (
      <RequirePermission any={['expense:approve', 'expense:pay']}>
        <ExpenseApprovalsPage />
      </RequirePermission>
    ),
  },
  // Notification deep links (`/expenses/:id`) open the claim over the list.
  { path: '/expenses/:id', element: <ExpensesPage /> },
];
