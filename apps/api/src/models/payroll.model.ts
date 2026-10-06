import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYROLL_STATUS, SALARY_CALCULATION_TYPES, SALARY_COMPONENT_TYPES } from '@stencil/shared';
import { baseSchemaOptions, ref, softDeleteField, tenantField } from './plugins';

const salaryComponentSchema = new Schema(
  {
    ...tenantField,
    name: { type: String, required: true },
    code: { type: String, required: true, uppercase: true },
    type: { type: String, enum: SALARY_COMPONENT_TYPES, required: true },
    calculationType: { type: String, enum: SALARY_CALCULATION_TYPES, default: 'FIXED' },
    defaultValue: { type: Number, default: 0 },
    maxAmount: { type: Number, default: 0 },
    baseCap: { type: Number, default: 0 },
    eligibilityMaxGross: { type: Number, default: 0 },
    slabs: {
      type: [{ _id: false, from: Number, to: { type: Number, default: null }, amount: Number }],
      default: [],
    },
    taxable: { type: Boolean, default: true },
    prorate: { type: Boolean, default: true },
    isStatutory: { type: Boolean, default: false },
    employerContribution: { type: Boolean, default: false },
    order: { type: Number, default: 100 },
    description: String,
    active: { type: Boolean, default: true },
    ...softDeleteField,
  },
  baseSchemaOptions,
);
salaryComponentSchema.index({ organizationId: 1, code: 1 }, { unique: true });
export type SalaryComponent = InferSchemaType<typeof salaryComponentSchema>;
export type SalaryComponentDoc = HydratedDocument<SalaryComponent>;
export const SalaryComponentModel = model('SalaryComponent', salaryComponentSchema);

/** Resolved line in a salary structure (monthly amounts). */
const structureLineSchema = new Schema(
  {
    componentId: { type: Schema.Types.ObjectId, ref: 'SalaryComponent', required: true },
    code: String,
    name: String,
    type: { type: String, enum: SALARY_COMPONENT_TYPES },
    calculationType: { type: String, enum: SALARY_CALCULATION_TYPES },
    value: Number,
    monthlyAmount: Number,
    employerContribution: { type: Boolean, default: false },
  },
  { _id: false },
);

/** Employee salary structure, versioned by effective date (never overwritten). */
const salaryStructureSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    currency: { type: String, required: true },
    basic: { type: Number, required: true },
    components: { type: [structureLineSchema], default: [] },
    monthlyGross: { type: Number, required: true },
    monthlyDeductions: { type: Number, required: true },
    monthlyEmployerContributions: { type: Number, default: 0 },
    monthlyNet: { type: Number, required: true },
    annualCtc: { type: Number, required: true },
    reason: String,
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
salaryStructureSchema.index({ organizationId: 1, employeeId: 1, effectiveFrom: -1 });
export type SalaryStructure = InferSchemaType<typeof salaryStructureSchema>;
export const SalaryStructureModel = model('SalaryStructure', salaryStructureSchema);

const salaryHistorySchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    structureId: ref('SalaryStructure', true),
    previousStructureId: ref('SalaryStructure'),
    effectiveFrom: { type: Date, required: true },
    previousCtc: { type: Number, default: 0 },
    newCtc: { type: Number, required: true },
    previousGross: { type: Number, default: 0 },
    newGross: { type: Number, required: true },
    changePercent: { type: Number, default: 0 },
    reason: String,
    changedBy: ref('User'),
  },
  { timestamps: true, versionKey: false },
);
salaryHistorySchema.index({ organizationId: 1, employeeId: 1, effectiveFrom: -1 });
export const SalaryHistoryModel = model('SalaryHistory', salaryHistorySchema);

const payrollSchema = new Schema(
  {
    ...tenantField,
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: PAYROLL_STATUS, default: 'DRAFT' },
    currency: { type: String, required: true },
    /** Restrict to specific employees (e.g. off-cycle final settlement). Empty = all active. */
    employeeIds: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
    isOffCycle: { type: Boolean, default: false },
    employeeCount: { type: Number, default: 0 },
    totalGross: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    totalNet: { type: Number, default: 0 },
    totalEmployerContributions: { type: Number, default: 0 },
    notes: String,
    warnings: [String],
    processedAt: Date,
    processedBy: ref('User'),
    approvedAt: Date,
    approvedBy: ref('User'),
    paidAt: Date,
    paidBy: ref('User'),
    paymentDate: Date,
    paymentReference: String,
    paymentMode: String,
    createdBy: ref('User'),
    statusHistory: {
      type: [{ _id: false, status: String, at: Date, by: { type: Schema.Types.ObjectId, ref: 'User' } }],
      default: [],
    },
  },
  baseSchemaOptions,
);
payrollSchema.add({
  /** `YYYY-MM` for active regular runs; null for off-cycle/cancelled. Enforces one regular run per month. */
  periodKey: { type: String, default: null },
});
payrollSchema.index({ organizationId: 1, year: -1, month: -1 });
payrollSchema.index(
  { organizationId: 1, periodKey: 1 },
  { unique: true, partialFilterExpression: { periodKey: { $type: 'string' } } },
);
export type Payroll = InferSchemaType<typeof payrollSchema>;
export type PayrollDoc = HydratedDocument<Payroll>;
export const PayrollModel = model('Payroll', payrollSchema);

const payslipLineSchema = new Schema(
  {
    code: String,
    name: String,
    amount: Number,
    /** STRUCTURE | OVERTIME | ADJUSTMENT | LOAN | ADVANCE */
    category: String,
    /** Source record (adjustment / loan id) for traceability. */
    refId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const payslipSchema = new Schema(
  {
    ...tenantField,
    payrollId: ref('Payroll', true),
    employeeId: ref('Employee', true),
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    currency: { type: String, required: true },
    status: { type: String, enum: ['DRAFT', 'FINAL', 'PAID', 'CANCELLED'], default: 'DRAFT' },
    /** Snapshot so historical payslips stay accurate after profile changes. */
    employeeSnapshot: {
      employeeId: String,
      name: String,
      workEmail: String,
      department: String,
      designation: String,
      location: String,
      joiningDate: Date,
      bankName: String,
      accountNumberMasked: String,
    },
    structureId: ref('SalaryStructure'),
    daysInPeriod: Number,
    workingDays: Number,
    payableDays: Number,
    presentDays: Number,
    paidLeaveDays: Number,
    unpaidLeaveDays: Number,
    absentDays: Number,
    holidays: Number,
    weekOffs: Number,
    overtimeHours: { type: Number, default: 0 },
    /** Days the payable basis is computed on (calendar or working days). */
    basisDays: Number,
    /** Days before joining / after exit within the period (per basis). */
    notEmployedDays: { type: Number, default: 0 },
    /** Loss-of-pay days = unpaid leave + unexcused absence. */
    lopDays: { type: Number, default: 0 },
    prorationFactor: { type: Number, default: 1 },
    earnings: { type: [payslipLineSchema], default: [] },
    deductions: { type: [payslipLineSchema], default: [] },
    employerContributions: { type: [payslipLineSchema], default: [] },
    grossEarnings: { type: Number, required: true },
    totalDeductions: { type: Number, required: true },
    netPay: { type: Number, required: true },
    paymentDate: Date,
    paymentReference: String,
    paymentMode: String,
  },
  baseSchemaOptions,
);
payslipSchema.index({ organizationId: 1, payrollId: 1, employeeId: 1 }, { unique: true });
payslipSchema.index({ organizationId: 1, employeeId: 1, year: -1, month: -1 });
export type Payslip = InferSchemaType<typeof payslipSchema>;
export const PayslipModel = model('Payslip', payslipSchema);

/** One-off earnings/deductions for a pay period (bonus, advance recovery...). */
const payrollAdjustmentSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    month: { type: Number, required: true },
    year: { type: Number, required: true },
    kind: { type: String, enum: ['EARNING', 'DEDUCTION'], required: true },
    category: { type: String, enum: ['BONUS', 'OVERTIME', 'ADVANCE', 'REIMBURSEMENT', 'OTHER'], required: true },
    amount: { type: Number, required: true, min: 0 },
    description: String,
    payrollId: ref('Payroll'),
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
payrollAdjustmentSchema.index({ organizationId: 1, year: 1, month: 1, employeeId: 1 });
payrollAdjustmentSchema.index({ organizationId: 1, payrollId: 1 });
export const PayrollAdjustmentModel = model('PayrollAdjustment', payrollAdjustmentSchema);

const loanSchema = new Schema(
  {
    ...tenantField,
    employeeId: ref('Employee', true),
    type: { type: String, enum: ['LOAN', 'ADVANCE'], required: true },
    principal: { type: Number, required: true },
    monthlyInstallment: { type: Number, required: true },
    outstanding: { type: Number, required: true },
    /** Balance written off when the loan was closed manually before full recovery. */
    writtenOff: { type: Number, default: 0 },
    startMonth: { type: Number, required: true },
    startYear: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' },
    description: String,
    repayments: {
      type: [{ _id: false, payrollId: Schema.Types.ObjectId, amount: Number, month: Number, year: Number, at: Date }],
      default: [],
    },
    createdBy: ref('User'),
  },
  baseSchemaOptions,
);
loanSchema.index({ organizationId: 1, employeeId: 1, status: 1 });
export const LoanModel = model('Loan', loanSchema);
