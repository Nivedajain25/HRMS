import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { salaryComponentSchema, type PaginationQuery } from '@stencil/shared';
import { EmployeeModel, SalaryComponentModel, SalaryHistoryModel, SalaryStructureModel, type Employee, type SalaryComponent } from '../models';
import { evaluateSalary, type EngineComponent, type EngineResult } from '../payroll/core/engine';
import { can, type RequestContext } from '../types/context';
import { addDaysKey, dateOnly, toDateKey, todayKey } from '../utils/dates';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { audit } from './audit.service';
import { createCrudService } from './crud.service';
import { recordSalaryHistory } from './employee.service';

type ComponentLean = SalaryComponent & { _id: Types.ObjectId };

/* ------------------------------ Components ----------------------------- */

const componentCrud = createCrudService({
  model: SalaryComponentModel,
  entity: 'Salary component',
  module: 'payroll',
  searchFields: ['name', 'code'],
  sortFields: ['name', 'code', 'order', 'type', 'createdAt'],
  defaultSort: { order: 1, name: 1 },
  label: (d) => `${d.name} (${d.code})`,
  prepare: async (ctx, input, existingId) => {
    if (!existingId) {
      if (input.code === 'BASIC') throw conflict('BASIC is a reserved system component code', 'RESERVED_CODE');
      if (await SalaryComponentModel.exists({ organizationId: ctx.organizationId, code: input.code })) {
        throw conflict('A component with this code already exists', 'CODE_TAKEN');
      }
      return input;
    }
    const existing = await SalaryComponentModel.findOne({ _id: existingId, organizationId: ctx.organizationId }).lean();
    if (!existing) throw notFound('Salary component');
    if (existing.code === 'BASIC') {
      if (input.code !== undefined && input.code !== 'BASIC') throw unprocessable('The BASIC component code cannot be changed', 'SYSTEM_COMPONENT');
      if (input.type !== undefined && input.type !== 'EARNING') throw unprocessable('BASIC must remain an earning', 'SYSTEM_COMPONENT');
      if (input.calculationType !== undefined && input.calculationType !== 'FIXED') throw unprocessable('BASIC must be a fixed amount', 'SYSTEM_COMPONENT');
      if (input.employerContribution) throw unprocessable('BASIC cannot be an employer contribution', 'SYSTEM_COMPONENT');
      if (input.active === false) throw unprocessable('BASIC cannot be deactivated', 'SYSTEM_COMPONENT');
    } else if (input.code === 'BASIC') {
      throw conflict('BASIC is a reserved system component code', 'RESERVED_CODE');
    }
    if (input.code !== undefined && input.code !== existing.code) {
      if (await SalaryComponentModel.exists({ organizationId: ctx.organizationId, code: input.code, _id: { $ne: existing._id } })) {
        throw conflict('A component with this code already exists', 'CODE_TAKEN');
      }
    }
    // Re-validate cross-field rules (slabs, percentage) on the merged document.
    const { _id, organizationId, createdAt, updatedAt, deletedAt, ...current } = existing as Record<string, unknown>;
    void _id;
    void organizationId;
    void createdAt;
    void updatedAt;
    void deletedAt;
    salaryComponentSchema.parse({ ...stripNulls(current), ...input });
    return input;
  },
});

const stripNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export const salaryComponents = {
  list: (ctx: RequestContext, q: PaginationQuery & { type?: string; active?: string }) =>
    componentCrud.list(ctx, q, {
      ...(q.type ? { type: q.type } : {}),
      ...(q.active ? { active: q.active === 'true' } : {}),
    } as FilterQuery<SalaryComponent>),
  all: (ctx: RequestContext) => componentCrud.all(ctx, { active: true } as FilterQuery<SalaryComponent>),
  get: componentCrud.get,
  create: componentCrud.create,
  update: componentCrud.update,
  /**
   * Archives a component. BASIC can never be archived; a component used by a
   * current or future salary structure is blocked (change those structures first).
   */
  remove: async (ctx: RequestContext, id: string) => {
    const doc = await SalaryComponentModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
    if (!doc) throw notFound('Salary component');
    if (doc.code === 'BASIC') throw unprocessable('The BASIC component is required and cannot be archived', 'SYSTEM_COMPONENT');
    const today = dateOnly(todayKey(ctx.timezone));
    const inUse = await SalaryStructureModel.exists({
      organizationId: ctx.organizationId,
      'components.componentId': doc._id,
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: today } }],
    });
    if (inUse) throw unprocessable('This component is used in an active salary structure', 'COMPONENT_IN_USE');
    doc.set({ deletedAt: new Date(), active: false });
    await doc.save();
    await audit(ctx, { action: 'RECORD_DELETED', module: 'payroll', recordId: doc._id, recordLabel: `${doc.name} (${doc.code})` });
  },
};

/* ------------------------------ Calculation ---------------------------- */

const toEngine = (c: ComponentLean, value: number): EngineComponent => ({
  componentId: String(c._id),
  code: c.code,
  name: c.name,
  type: c.type as EngineComponent['type'],
  calculationType: (c.calculationType ?? 'FIXED') as EngineComponent['calculationType'],
  value: c.calculationType === 'SLAB' ? 0 : value,
  maxAmount: c.maxAmount ?? 0,
  baseCap: c.baseCap ?? 0,
  eligibilityMaxGross: c.eligibilityMaxGross ?? 0,
  slabs: (c.slabs ?? []).map((s) => ({ from: s.from ?? 0, to: s.to ?? null, amount: s.amount ?? 0 })),
  prorate: c.prorate ?? true,
  employerContribution: c.employerContribution ?? false,
  order: c.order ?? 100,
});

const loadBasic = async (organizationId: Types.ObjectId, session?: ClientSession) => {
  const basic = (await SalaryComponentModel.findOne({ organizationId, code: 'BASIC' }).session(session ?? null).lean()) as ComponentLean | null;
  if (!basic) throw unprocessable('The BASIC salary component is missing for this organization', 'BASIC_COMPONENT_MISSING');
  return basic;
};

/** Validates structure component inputs against the organization's master data. */
const resolveComponents = async (ctx: RequestContext, inputs: { componentId: string; value: number }[], session?: ClientSession) => {
  const ids = inputs.map((i) => i.componentId);
  if (new Set(ids).size !== ids.length) throw badRequest('Each component can only be added once', 'DUPLICATE_COMPONENT');
  const docs = (await SalaryComponentModel.find({ _id: { $in: ids }, organizationId: ctx.organizationId, deletedAt: null })
    .session(session ?? null)
    .lean()) as unknown as ComponentLean[];
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const components: EngineComponent[] = [];
  inputs.forEach((input, index) => {
    const doc = byId.get(input.componentId);
    if (!doc) {
      throw badRequest('Salary component not found', 'INVALID_REFERENCE', [{ path: `components.${index}.componentId`, message: 'Salary component not found' }]);
    }
    if (doc.active === false) {
      throw badRequest(`${doc.name} is inactive`, 'INACTIVE_COMPONENT', [{ path: `components.${index}.componentId`, message: 'Component is inactive' }]);
    }
    if (doc.code === 'BASIC') return; // basic comes from the `basic` field
    if (doc.calculationType?.startsWith('PERCENT') && input.value > 100) {
      throw badRequest('Percentage cannot exceed 100', 'VALIDATION_ERROR', [{ path: `components.${index}.value`, message: 'Percentage cannot exceed 100' }]);
    }
    components.push(toEngine(doc, input.value));
  });
  return components;
};

const structureLines = (result: EngineResult) =>
  [...result.earnings, ...result.deductions, ...result.employerContributions].map((l) => ({
    componentId: l.componentId ? new Types.ObjectId(l.componentId) : undefined,
    code: l.code,
    name: l.name,
    type: l.type,
    calculationType: l.calculationType === 'EXTRA' ? 'FIXED' : l.calculationType,
    value: l.value,
    monthlyAmount: l.amount,
    employerContribution: l.employerContribution,
  }));

const summarize = (result: EngineResult) => ({
  earnings: result.earnings.map(({ componentId, code, name, calculationType, value, amount }) => ({ componentId, code, name, calculationType, value, amount })),
  deductions: result.deductions.map(({ componentId, code, name, calculationType, value, amount }) => ({ componentId, code, name, calculationType, value, amount })),
  employerContributions: result.employerContributions.map(({ componentId, code, name, calculationType, value, amount }) => ({ componentId, code, name, calculationType, value, amount })),
  monthlyGross: result.gross,
  monthlyDeductions: result.totalDeductions,
  monthlyEmployerContributions: result.totalEmployerContributions,
  monthlyNet: result.net,
  annualGross: Math.round(result.gross * 12 * 100) / 100,
  annualCtc: result.annualCtc,
});

export const computeStructure = async (
  ctx: RequestContext,
  input: { basic: number; components: { componentId: string; value: number }[] },
  session?: ClientSession,
) => {
  const [basic, components] = await Promise.all([loadBasic(ctx.organizationId, session), resolveComponents(ctx, input.components, session)]);
  const result = evaluateSalary({
    basic: input.basic,
    basicComponent: { componentId: String(basic._id), name: basic.name, prorate: basic.prorate ?? true },
    components,
  });
  return { result, lines: structureLines(result) };
};

export const previewStructure = async (ctx: RequestContext, input: { basic: number; components: { componentId: string; value: number }[] }) => {
  const { result } = await computeStructure(ctx, input);
  return { currency: ctx.currency, basic: input.basic, ...summarize(result) };
};

/**
 * Engine inputs for a stored structure: values come from the structure
 * version, caps/slabs/eligibility/proration from the component master.
 */
export const engineInputFromStructure = async (
  organizationId: Types.ObjectId,
  structure: { basic: number; components: { componentId?: unknown; code?: string | null; name?: string | null; type?: string | null; calculationType?: string | null; value?: number | null; employerContribution?: boolean | null }[] },
  masters?: Map<string, ComponentLean>,
) => {
  let map = masters;
  if (!map) {
    const ids = structure.components.map((c) => c.componentId).filter(Boolean);
    const docs = (await SalaryComponentModel.find({ organizationId, _id: { $in: ids } }).lean()) as unknown as ComponentLean[];
    map = new Map(docs.map((d) => [String(d._id), d]));
  }
  const basicLine = structure.components.find((c) => c.code === 'BASIC');
  const basicMaster = basicLine ? map.get(String(basicLine.componentId)) : undefined;
  const components: EngineComponent[] = structure.components
    .filter((c) => c.code !== 'BASIC')
    .map((line) => {
      const master = map!.get(String(line.componentId));
      const base = master ? toEngine(master, line.value ?? 0) : undefined;
      return {
        ...(base ?? { prorate: true, order: 100 }),
        componentId: String(line.componentId),
        code: line.code ?? base?.code ?? 'COMPONENT',
        name: line.name ?? base?.name ?? 'Component',
        type: (line.type ?? base?.type ?? 'EARNING') as EngineComponent['type'],
        calculationType: (line.calculationType ?? base?.calculationType ?? 'FIXED') as EngineComponent['calculationType'],
        value: line.calculationType === 'SLAB' ? 0 : (line.value ?? 0),
        employerContribution: line.employerContribution ?? base?.employerContribution ?? false,
      } as EngineComponent;
    });
  return {
    basic: structure.basic,
    basicComponent: { componentId: basicLine ? String(basicLine.componentId) : undefined, name: basicLine?.name ?? basicMaster?.name ?? 'Basic Salary', prorate: basicMaster?.prorate ?? true },
    components,
  };
};

/* ------------------------------ Structures ----------------------------- */

export const createStructure = async (
  ctx: RequestContext,
  input: { employeeId: string; effectiveFrom: string; basic: number; components: { componentId: string; value: number }[]; reason: string },
) => {
  const employee = await EmployeeModel.findOne({ _id: input.employeeId, organizationId: ctx.organizationId, deletedAt: null })
    .select('firstName lastName employeeId')
    .lean();
  if (!employee) throw badRequest('Employee not found', 'INVALID_REFERENCE', [{ path: 'employeeId', message: 'Employee not found' }]);
  const effectiveFrom = dateOnly(input.effectiveFrom);

  const { structure, previous } = await withTransaction(async (session) => {
    const { result, lines } = await computeStructure(ctx, input, session);
    const previous = await SalaryStructureModel.findOne({ organizationId: ctx.organizationId, employeeId: employee._id })
      .sort({ effectiveFrom: -1 })
      .session(session ?? null);
    if (previous && previous.effectiveFrom >= effectiveFrom) {
      throw unprocessable(
        `The new structure must be effective after ${toDateKey(previous.effectiveFrom)} (the latest version)`,
        'EFFECTIVE_DATE_INVALID',
      );
    }
    if (previous && (!previous.effectiveTo || previous.effectiveTo >= effectiveFrom)) {
      previous.effectiveTo = dateOnly(addDaysKey(input.effectiveFrom, -1));
      await previous.save({ session });
    }
    const [structure] = await SalaryStructureModel.create(
      [
        {
          organizationId: ctx.organizationId,
          employeeId: employee._id,
          effectiveFrom,
          effectiveTo: null,
          currency: ctx.currency,
          basic: input.basic,
          components: lines,
          monthlyGross: result.gross,
          monthlyDeductions: result.totalDeductions,
          monthlyEmployerContributions: result.totalEmployerContributions,
          monthlyNet: result.net,
          annualCtc: result.annualCtc,
          reason: input.reason,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    const previousCtc = previous?.annualCtc ?? 0;
    const previousGross = previous?.monthlyGross ?? 0;
    await SalaryHistoryModel.create(
      [
        {
          organizationId: ctx.organizationId,
          employeeId: employee._id,
          structureId: structure!._id,
          previousStructureId: previous?._id ?? null,
          effectiveFrom,
          previousCtc,
          newCtc: result.annualCtc,
          previousGross,
          newGross: result.gross,
          changePercent: previousCtc ? Math.round(((result.annualCtc - previousCtc) / previousCtc) * 10000) / 100 : 0,
          reason: input.reason,
          changedBy: ctx.userId,
        },
      ],
      { session },
    );
    await recordSalaryHistory(ctx, employee._id, previousCtc, result.annualCtc, effectiveFrom, input.reason, session);
    return { structure: structure!, previous: previous ? { annualCtc: previous.annualCtc, monthlyGross: previous.monthlyGross } : null };
  });

  await audit(ctx, {
    action: 'SALARY_UPDATED',
    module: 'payroll',
    recordId: structure._id,
    recordLabel: `${employee.firstName} ${employee.lastName} (${employee.employeeId})`,
    oldValues: previous ? { annualCtc: previous.annualCtc, monthlyGross: previous.monthlyGross } : null,
    newValues: { annualCtc: structure.annualCtc, monthlyGross: structure.monthlyGross, effectiveFrom: input.effectiveFrom, reason: input.reason },
  });
  return structure.toJSON();
};

/** Structure in force on a date (YYYY-MM-DD). */
export const structureAsOf = (organizationId: Types.ObjectId, employeeId: Types.ObjectId | string, dateKey: string, session?: ClientSession) =>
  SalaryStructureModel.findOne({
    organizationId,
    employeeId,
    effectiveFrom: { $lte: dateOnly(dateKey) },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: dateOnly(dateKey) } }],
  })
    .sort({ effectiveFrom: -1 })
    .session(session ?? null)
    .lean();

/** Salary data is visible to the employee themself or `salary:read` holders only (never to managers). */
const assertSalaryAccess = async (ctx: RequestContext, employeeId: string) => {
  const self = ctx.employeeId?.equals(employeeId) ?? false;
  if (!self && !can(ctx, 'salary:read')) throw forbidden('You do not have access to this salary information');
  const employee = await EmployeeModel.findOne({ _id: employeeId, organizationId: ctx.organizationId })
    .select('employeeId firstName lastName departmentId designationId joiningDate employmentStatus')
    .populate([{ path: 'departmentId', select: 'name' }, { path: 'designationId', select: 'name' }])
    .lean();
  if (!employee) throw notFound('Employee');
  return employee;
};

export const getEmployeeSalary = async (ctx: RequestContext, employeeId: string) => {
  const employee = await assertSalaryAccess(ctx, employeeId);
  const [current, versions, history] = await Promise.all([
    structureAsOf(ctx.organizationId, employee._id, todayKey(ctx.timezone)),
    SalaryStructureModel.find({ organizationId: ctx.organizationId, employeeId: employee._id }).sort({ effectiveFrom: -1 }).lean(),
    SalaryHistoryModel.find({ organizationId: ctx.organizationId, employeeId: employee._id })
      .sort({ effectiveFrom: -1 })
      .populate({ path: 'changedBy', select: 'firstName lastName' })
      .lean(),
  ]);
  return { employee, current: current ?? null, upcoming: versions.find((v) => v.effectiveFrom > dateOnly(todayKey(ctx.timezone))) ?? null, versions, history };
};

/** Employees with their current structure (salary:read). */
export const listSalaries = async (ctx: RequestContext, q: PaginationQuery & { department?: string }) => {
  const filter: FilterQuery<Employee> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
    ...searchFilter(q.search, ['firstName', 'lastName', 'employeeId', 'workEmail']),
    ...(q.department ? { departmentId: new Types.ObjectId(q.department) } : {}),
  };
  const page = await paginate(EmployeeModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['firstName', 'lastName', 'employeeId', 'joiningDate'], { firstName: 1, lastName: 1 }),
    populate: [{ path: 'departmentId', select: 'name' }, { path: 'designationId', select: 'name' }],
    select: 'employeeId firstName lastName profilePhoto departmentId designationId joiningDate employmentStatus',
  });
  const today = dateOnly(todayKey(ctx.timezone));
  const structures = await SalaryStructureModel.find({
    organizationId: ctx.organizationId,
    employeeId: { $in: page.items.map((e) => e._id) },
    effectiveFrom: { $lte: today },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: today } }],
  })
    .select('employeeId effectiveFrom basic monthlyGross monthlyNet monthlyDeductions monthlyEmployerContributions annualCtc currency')
    .lean();
  const byEmployee = new Map(structures.map((s) => [String(s.employeeId), s]));
  return {
    items: page.items.map((e) => ({ ...e, currentStructure: byEmployee.get(String(e._id)) ?? null })),
    pagination: page.pagination,
  };
};
