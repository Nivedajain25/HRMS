import { z } from 'zod';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUS,
  commentBody,
  expensePaySchema,
  expenseSchema,
  expenseUpdateSchema,
  idParam,
  optionalDateString,
  optionalObjectId,
  paginationQuery,
  rejectBody,
} from '@stencil/shared';
import { expenseController as expenses } from '../controllers/operations.controller';
import { createModule } from './registry';

export const expenseModule = createModule('Expenses', '/api/v1/expenses');
expenseModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List expenses (scope me/team/all, `approvals` = awaiting me, `payable` = approved awaiting payment)',
    query: paginationQuery.extend({
      scope: z.enum(['me', 'team', 'all', 'approvals', 'payable']).optional(),
      status: z.enum(EXPENSE_STATUS).optional(),
      category: z.enum(EXPENSE_CATEGORIES).optional(),
      from: optionalDateString,
      to: optionalDateString,
      employeeId: optionalObjectId,
    }),
  },
  expenses.list,
);
expenseModule.route(
  {
    method: 'get',
    path: '/summary',
    summary: 'Totals by status and category (scoped)',
    query: z.object({ from: optionalDateString, to: optionalDateString, scope: z.enum(['me', 'team', 'all']).optional() }),
  },
  expenses.summary,
);
expenseModule.route({ method: 'get', path: '/:id', summary: 'Get an expense (IDOR-protected)', params: idParam }, expenses.get);
expenseModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Create an expense claim (submitted for approval unless `submit: false`)',
    description: '`employeeId` (on behalf of someone else) requires `expense:create`. `receiptFileId` comes from `POST /files` with context EXPENSE.',
    body: expenseSchema,
  },
  expenses.create,
);
expenseModule.route({ method: 'patch', path: '/:id', summary: 'Edit a draft expense (owner)', params: idParam, body: expenseUpdateSchema }, expenses.update);
expenseModule.route({ method: 'post', path: '/:id/submit', summary: 'Submit a draft for approval (owner)', params: idParam }, expenses.submit);
expenseModule.route(
  { method: 'post', path: '/:id/approve', summary: 'Approve the current step (FINANCE steps: expense:pay)', anyPermission: ['expense:approve', 'expense:pay'], params: idParam, body: commentBody },
  expenses.approve,
);
expenseModule.route(
  { method: 'post', path: '/:id/reject', summary: 'Reject (reason required; FINANCE steps: expense:pay)', anyPermission: ['expense:reject', 'expense:pay'], params: idParam, body: rejectBody },
  expenses.reject,
);
expenseModule.route({ method: 'post', path: '/:id/cancel', summary: 'Cancel before approval (owner)', params: idParam }, expenses.cancel);
expenseModule.route(
  { method: 'post', path: '/:id/pay', summary: 'Mark an approved expense as paid', permissions: ['expense:pay'], params: idParam, body: expensePaySchema },
  expenses.pay,
);
