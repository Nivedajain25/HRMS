import type { Request, Response } from 'express';
import { getCtx } from '../middleware/auth';
import { body, query } from '../middleware/validate';
import * as payroll from '../services/payroll.service';
import * as payslips from '../services/payslip.service';
import * as salary from '../services/salary.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

// Inputs are validated by the route's Zod schemas; `never` lets each service declare its own input type.
const q = (req: Request) => query<never>(req);
const b = (req: Request) => body<never>(req);

const sendFile = (res: Response, file: { buffer: Buffer; filename: string; contentType: string }) => {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Length', String(file.buffer.length));
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(file.buffer);
};

export const salaryComponentController = {
  list: handlePaged((ctx, req) => salary.salaryComponents.list(ctx, q(req))),
  all: handle((ctx) => salary.salaryComponents.all(ctx)),
  get: handle((ctx, req) => salary.salaryComponents.get(ctx, idOf(req))),
  create: handleCreated((ctx, req) => salary.salaryComponents.create(ctx, b(req)), 'Salary component created'),
  update: handle((ctx, req) => salary.salaryComponents.update(ctx, idOf(req), b(req)), 'Salary component updated'),
  remove: handle((ctx, req) => salary.salaryComponents.remove(ctx, idOf(req)), 'Salary component archived'),
};

export const salaryController = {
  list: handlePaged((ctx, req) => salary.listSalaries(ctx, q(req))),
  preview: handle((ctx, req) => salary.previewStructure(ctx, b(req))),
  create: handleCreated((ctx, req) => salary.createStructure(ctx, b(req)), 'Salary structure saved'),
  forEmployee: handle((ctx, req) => salary.getEmployeeSalary(ctx, idOf(req, 'employeeId'))),
};

export const payrollController = {
  list: handlePaged((ctx, req) => payroll.listPayrolls(ctx, q(req))),
  summary: handle((ctx, req) => payroll.payrollSummary(ctx, q(req))),
  create: handleCreated((ctx, req) => payroll.createPayroll(ctx, b(req)), 'Payroll created'),
  processByPeriod: handle((ctx, req) => payroll.processByPeriod(ctx, b(req)), 'Payroll processed'),
  get: handle((ctx, req) => payroll.getPayroll(ctx, idOf(req))),
  payslips: handlePaged((ctx, req) => payroll.listRunPayslips(ctx, idOf(req), q(req))),
  process: handle((ctx, req) => payroll.processPayroll(ctx, idOf(req)), 'Payroll processed'),
  approve: handle((ctx, req) => payroll.approvePayroll(ctx, idOf(req)), 'Payroll approved'),
  pay: handle((ctx, req) => payroll.payPayroll(ctx, idOf(req), b(req)), 'Payroll marked as paid'),
  cancel: handle((ctx, req) => payroll.cancelPayroll(ctx, idOf(req)), 'Payroll cancelled'),
  reopen: handle((ctx, req) => payroll.reopenPayroll(ctx, idOf(req)), 'Payroll reopened for review'),
  export: async (req: Request, res: Response) => {
    const file = await payroll.exportPayroll(getCtx(req), idOf(req), query<{ format?: 'csv' | 'xlsx' }>(req).format ?? 'csv');
    sendFile(res, file);
  },

  listAdjustments: handlePaged((ctx, req) => payroll.adjustments.list(ctx, q(req))),
  getAdjustment: handle((ctx, req) => payroll.adjustments.get(ctx, idOf(req))),
  createAdjustment: handleCreated((ctx, req) => payroll.adjustments.create(ctx, b(req)), 'Adjustment created'),
  updateAdjustment: handle((ctx, req) => payroll.adjustments.update(ctx, idOf(req), b(req)), 'Adjustment updated'),
  removeAdjustment: handle((ctx, req) => payroll.adjustments.remove(ctx, idOf(req)), 'Adjustment deleted'),

  listLoans: handlePaged((ctx, req) => payroll.loans.list(ctx, q(req))),
  getLoan: handle((ctx, req) => payroll.loans.get(ctx, idOf(req))),
  createLoan: handleCreated((ctx, req) => payroll.loans.create(ctx, b(req)), 'Loan created'),
  closeLoan: handle((ctx, req) => payroll.loans.close(ctx, idOf(req)), 'Loan closed'),
};

export const payslipController = {
  list: handlePaged((ctx, req) => payslips.listPayslips(ctx, q(req))),
  get: handle((ctx, req) => payslips.getPayslip(ctx, idOf(req))),
  pdf: async (req: Request, res: Response) => {
    const file = await payslips.payslipPdf(getCtx(req), idOf(req));
    sendFile(res, { ...file, contentType: 'application/pdf' });
  },
};
