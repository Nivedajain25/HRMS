import { z } from 'zod';
import { PAYROLL_STATUS, SALARY_CALCULATION_TYPES, SALARY_COMPONENT_TYPES } from '../enums';
import {
  dateString,
  money,
  objectId,
  optionalObjectId,
  optionalString,
  paginationQuery,
  patchSchema,
  requiredString,
} from './common';

export const slabSchema = z.object({
  from: money,
  to: money.nullable(),
  amount: money,
});

const salaryComponentBaseSchema = z.object({
    name: requiredString('Name', 80),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,16}$/),
    type: z.enum(SALARY_COMPONENT_TYPES),
    calculationType: z.enum(SALARY_CALCULATION_TYPES).default('FIXED'),
    /** Amount (FIXED) or percentage (PERCENT_*). Ignored for SLAB. */
    defaultValue: z.coerce.number().min(0).max(1e9).default(0),
    /** Upper cap on the computed monthly amount, 0 = no cap. */
    maxAmount: money.default(0),
    /** Base on which percentage is capped (e.g. PF on basic up to 15000). 0 = none. */
    baseCap: money.default(0),
    /** Component only applies when monthly gross is at or below this (e.g. ESI). 0 = always. */
    eligibilityMaxGross: money.default(0),
    slabs: z.array(slabSchema).max(20).default([]),
    taxable: z.boolean().default(true),
    prorate: z.boolean().default(true),
    isStatutory: z.boolean().default(false),
    /** Employer contribution counted in CTC but not in gross (e.g. employer PF). */
    employerContribution: z.boolean().default(false),
    order: z.coerce.number().int().min(0).max(999).default(100),
    description: optionalString(300),
    active: z.boolean().default(true),
  });

export const salaryComponentSchema = salaryComponentBaseSchema
  .refine((d) => d.calculationType !== 'SLAB' || d.slabs.length > 0, {
    message: 'Slab components need at least one slab',
    path: ['slabs'],
  })
  .refine((d) => !d.calculationType.startsWith('PERCENT') || d.defaultValue <= 100, {
    message: 'Percentage cannot exceed 100',
    path: ['defaultValue'],
  });
export type SalaryComponentInput = z.input<typeof salaryComponentSchema>;

/**
 * PATCH body for components: omitted fields stay untouched (no defaults).
 * Cross-field rules are re-validated by the service on the merged document.
 */
export const salaryComponentUpdateSchema = patchSchema(salaryComponentBaseSchema).refine(
  (d) => !d.calculationType?.startsWith('PERCENT') || d.defaultValue === undefined || d.defaultValue <= 100,
  { message: 'Percentage cannot exceed 100', path: ['defaultValue'] },
);

export const salaryComponentListQuery = paginationQuery.extend({
  type: z.enum(SALARY_COMPONENT_TYPES).optional(),
  active: z.enum(['true', 'false']).optional(),
});

export const salaryListQuery = paginationQuery.extend({
  department: optionalObjectId,
});

export const salaryStructureSchema = z.object({
  employeeId: objectId,
  effectiveFrom: dateString,
  basic: money,
  components: z
    .array(
      z.object({
        componentId: objectId,
        value: z.coerce.number().min(0).max(1e9),
      }),
    )
    .max(50),
  reason: requiredString('Reason for change', 300),
});
export type SalaryStructureInput = z.input<typeof salaryStructureSchema>;

export const salaryPreviewSchema = salaryStructureSchema.omit({ employeeId: true, reason: true, effectiveFrom: true });

export const payrollCreateSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  employeeIds: z.array(objectId).max(5000).optional(),
  notes: optionalString(500),
});
export type PayrollCreateInput = z.input<typeof payrollCreateSchema>;

export const payrollAdjustmentSchema = z.object({
  employeeId: objectId,
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  kind: z.enum(['EARNING', 'DEDUCTION']),
  category: z.enum(['BONUS', 'OVERTIME', 'ADVANCE', 'REIMBURSEMENT', 'OTHER']),
  amount: money.refine((v) => v > 0, 'Amount must be positive'),
  description: requiredString('Description', 200),
});
export type PayrollAdjustmentInput = z.input<typeof payrollAdjustmentSchema>;

export const loanSchema = z.object({
  employeeId: objectId,
  type: z.enum(['LOAN', 'ADVANCE']),
  principal: money.refine((v) => v > 0, 'Amount must be positive'),
  monthlyInstallment: money.refine((v) => v > 0, 'Installment must be positive'),
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2100),
  description: optionalString(300),
});
export type LoanInput = z.input<typeof loanSchema>;

export const payrollAdjustmentUpdateSchema = patchSchema(payrollAdjustmentSchema.omit({ employeeId: true }));

export const payrollAdjustmentListQuery = paginationQuery.extend({
  employeeId: optionalObjectId,
  payrollId: optionalObjectId,
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const loanListQuery = paginationQuery.extend({
  employeeId: optionalObjectId,
  status: z.enum(['ACTIVE', 'CLOSED']).optional(),
});

export const payrollListQuery = paginationQuery.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.enum(PAYROLL_STATUS).optional(),
});

/** Process an existing run (`payrollId`) or the regular run for a month (created if missing). */
export const payrollProcessSchema = z
  .object({
    payrollId: optionalObjectId,
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .refine((d) => !!d.payrollId || (d.month !== undefined && d.year !== undefined), {
    message: 'Provide payrollId or month and year',
    path: ['payrollId'],
  });

export const payrollSummaryQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const payrollExportQuery = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

export const payslipListQuery = paginationQuery.extend({
  employeeId: optionalObjectId,
  payrollId: optionalObjectId,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  scope: z.enum(['me', 'all']).optional(),
});

export const payrollPaySchema = z.object({
  paymentDate: dateString,
  paymentReference: optionalString(100),
  paymentMode: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER']).default('BANK_TRANSFER'),
});
