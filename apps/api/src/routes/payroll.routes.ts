import { z } from 'zod';
import {
  idParam,
  loanListQuery,
  loanSchema,
  objectId,
  paginationQuery,
  payrollAdjustmentListQuery,
  payrollAdjustmentSchema,
  payrollAdjustmentUpdateSchema,
  payrollCreateSchema,
  payrollExportQuery,
  payrollListQuery,
  payrollPaySchema,
  payrollProcessSchema,
  payrollSummaryQuery,
  payslipListQuery,
  salaryComponentListQuery,
  salaryComponentSchema,
  salaryComponentUpdateSchema,
  salaryListQuery,
  salaryPreviewSchema,
  salaryStructureSchema,
} from '@stencil/shared';
import {
  payrollController as pc,
  payslipController as ps,
  salaryComponentController as scc,
  salaryController as sc,
} from '../controllers/payroll.controller';
import { createModule } from './registry';

/* --------------------------- Salary components --------------------------- */

export const salaryComponentModule = createModule('Salary Components', '/api/v1/salary-components');
salaryComponentModule.route({ method: 'get', path: '/', summary: 'List salary components', permissions: ['salary:read'], query: salaryComponentListQuery }, scc.list);
salaryComponentModule.route({ method: 'get', path: '/all', summary: 'All active salary components (for pickers)', permissions: ['salary:read'] }, scc.all);
salaryComponentModule.route({ method: 'get', path: '/:id', summary: 'Get a salary component', permissions: ['salary:read'], params: idParam }, scc.get);
salaryComponentModule.route({ method: 'post', path: '/', summary: 'Create a salary component', permissions: ['salary:update'], body: salaryComponentSchema }, scc.create);
salaryComponentModule.route(
  {
    method: 'patch',
    path: '/:id',
    summary: 'Update a salary component',
    description: 'BASIC is a system component: its code, type (EARNING) and calculation (FIXED) cannot change.',
    permissions: ['salary:update'],
    params: idParam,
    body: salaryComponentUpdateSchema,
  },
  scc.update,
);
salaryComponentModule.route(
  {
    method: 'delete',
    path: '/:id',
    summary: 'Archive a salary component',
    description: 'BASIC cannot be archived. Components used by a current or future salary structure are blocked (422 COMPONENT_IN_USE).',
    permissions: ['salary:update'],
    params: idParam,
  },
  scc.remove,
);

/* --------------------------- Salary structures --------------------------- */

export const salaryModule = createModule('Salary', '/api/v1/salary');
salaryModule.route(
  { method: 'get', path: '/', summary: 'Employees with their current salary structure', permissions: ['salary:read'], query: salaryListQuery },
  sc.list,
);
salaryModule.route(
  {
    method: 'post',
    path: '/preview',
    summary: 'Preview a salary structure (monthly lines, gross, deductions, net, annual CTC)',
    description: 'CTC = 12 × (gross + employer contributions). Component `value` is an amount (FIXED) or a percentage (PERCENT_*); ignored for SLAB.',
    anyPermission: ['salary:update', 'salary:read'],
    body: salaryPreviewSchema,
  },
  sc.preview,
);
salaryModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Create a new salary structure version for an employee',
    description: 'Closes the previous version (effectiveTo = day before), records salary history and audit. effectiveFrom must be after the latest version.',
    permissions: ['salary:update'],
    body: salaryStructureSchema,
  },
  sc.create,
);
salaryModule.route(
  {
    method: 'get',
    path: '/employee/:employeeId',
    summary: 'Salary of an employee: current structure, versions and history',
    description: 'Visible to the employee themself or `salary:read` holders. Managers without `salary:read` get 403.',
    params: z.object({ employeeId: objectId }),
  },
  sc.forEmployee,
);

/* ------------------------------ Payroll runs ----------------------------- */

export const payrollModule = createModule('Payroll', '/api/v1/payroll');
payrollModule.route({ method: 'get', path: '/', summary: 'List payroll runs', permissions: ['payroll:read'], query: payrollListQuery }, pc.list);
payrollModule.route({ method: 'get', path: '/summary', summary: 'Monthly payroll totals for a year', permissions: ['payroll:read'], query: payrollSummaryQuery }, pc.summary);
payrollModule.route(
  {
    method: 'post',
    path: '/',
    summary: 'Create a draft payroll run',
    description: 'One regular run per month (409 on duplicates). Passing `employeeIds` creates an off-cycle run (e.g. final settlement).',
    permissions: ['payroll:create'],
    body: payrollCreateSchema,
  },
  pc.create,
);
payrollModule.route(
  {
    method: 'post',
    path: '/process',
    summary: 'Process a payroll run by id, or the regular run of a month (created when missing)',
    permissions: ['payroll:process'],
    body: payrollProcessSchema,
  },
  pc.processByPeriod,
);

// Adjustments (one-off earnings/deductions)
payrollModule.route(
  { method: 'get', path: '/adjustments', summary: 'List payroll adjustments', anyPermission: ['payroll:create', 'payroll:read'], query: payrollAdjustmentListQuery },
  pc.listAdjustments,
);
payrollModule.route({ method: 'post', path: '/adjustments', summary: 'Create a payroll adjustment', permissions: ['payroll:create'], body: payrollAdjustmentSchema }, pc.createAdjustment);
payrollModule.route(
  { method: 'get', path: '/adjustments/:id', summary: 'Get a payroll adjustment', anyPermission: ['payroll:create', 'payroll:read'], params: idParam },
  pc.getAdjustment,
);
payrollModule.route(
  {
    method: 'patch',
    path: '/adjustments/:id',
    summary: 'Update a payroll adjustment',
    description: 'Blocked (422) once linked to an approved or paid payroll.',
    permissions: ['payroll:create'],
    params: idParam,
    body: payrollAdjustmentUpdateSchema,
  },
  pc.updateAdjustment,
);
payrollModule.route(
  { method: 'delete', path: '/adjustments/:id', summary: 'Delete a payroll adjustment', permissions: ['payroll:create'], params: idParam },
  pc.removeAdjustment,
);

// Loans & salary advances
payrollModule.route({ method: 'get', path: '/loans', summary: 'List loans and advances', anyPermission: ['payroll:create', 'payroll:read'], query: loanListQuery }, pc.listLoans);
payrollModule.route({ method: 'post', path: '/loans', summary: 'Create a loan or salary advance', permissions: ['payroll:create'], body: loanSchema }, pc.createLoan);
payrollModule.route({ method: 'get', path: '/loans/:id', summary: 'Get a loan with repayments', anyPermission: ['payroll:create', 'payroll:read'], params: idParam }, pc.getLoan);
payrollModule.route({ method: 'post', path: '/loans/:id/close', summary: 'Close a loan (write off the outstanding amount)', permissions: ['payroll:create'], params: idParam }, pc.closeLoan);

payrollModule.route({ method: 'get', path: '/:id', summary: 'Get a payroll run with totals and payslip summaries', permissions: ['payroll:read'], params: idParam }, pc.get);
payrollModule.route(
  { method: 'get', path: '/:id/payslips', summary: 'Payslips of a run (paginated)', permissions: ['payroll:read'], params: idParam, query: paginationQuery },
  pc.payslips,
);
payrollModule.route(
  {
    method: 'get',
    path: '/:id/export',
    summary: 'Export the payroll register (CSV or XLSX)',
    permissions: ['payroll:read'],
    params: idParam,
    query: payrollExportQuery,
    binary: true,
  },
  pc.export,
);
payrollModule.route({ method: 'post', path: '/:id/process', summary: 'Process (compute) a payroll run', permissions: ['payroll:process'], params: idParam }, pc.process);
payrollModule.route(
  {
    method: 'post',
    path: '/:id/approve',
    summary: 'Approve a payroll run (payslips become final)',
    description: 'The approver must differ from the processor unless nobody else holds `payroll:approve`.',
    permissions: ['payroll:approve'],
    params: idParam,
  },
  pc.approve,
);
payrollModule.route(
  { method: 'post', path: '/:id/pay', summary: 'Mark an approved payroll as paid', permissions: ['payroll:approve'], params: idParam, body: payrollPaySchema },
  pc.pay,
);
payrollModule.route({ method: 'post', path: '/:id/cancel', summary: 'Cancel a draft or in-review payroll', permissions: ['payroll:create'], params: idParam }, pc.cancel);
payrollModule.route({ method: 'post', path: '/:id/reopen', summary: 'Reopen an approved payroll for review', permissions: ['payroll:approve'], params: idParam }, pc.reopen);

/* -------------------------------- Payslips ------------------------------- */

export const payslipModule = createModule('Payslips', '/api/v1/payslips');
payslipModule.route(
  {
    method: 'get',
    path: '/',
    summary: 'List payslips (own by default)',
    description: 'Employees only see their own FINAL/PAID payslips. `employeeId` of someone else or `scope=all` requires `payroll:read`.',
    query: payslipListQuery,
  },
  ps.list,
);
payslipModule.route({ method: 'get', path: '/:id', summary: 'Get a payslip (owner or payroll:read)', params: idParam }, ps.get);
payslipModule.route({ method: 'get', path: '/:id/pdf', summary: 'Download a payslip PDF', params: idParam, binary: true }, ps.pdf);
