import type { ClientSession, FilterQuery, Types } from 'mongoose';
import type { PaginationQuery } from '@stencil/shared';
import { EmployeeModel, OnboardingModel, OnboardingTemplateModel, type Onboarding } from '../models';
import { can, type RequestContext } from '../types/context';
import { addDaysKey, dateOnly, toDateKey } from '../utils/dates';
import { conflict, forbidden, notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';
import { createCrudService } from './crud.service';
import { managerUserId, notify } from './notification.service';
import { getReportIds, isManagerOf } from './scope.service';

export const onboardingTemplates = createCrudService({
  model: OnboardingTemplateModel,
  entity: 'Onboarding template',
  module: 'onboarding',
  searchFields: ['name'],
  sortFields: ['name', 'createdAt'],
  populate: [{ path: 'departmentId', select: 'name' }],
  prepare: async (ctx, input, existingId) => {
    if (input.isDefault) {
      await OnboardingTemplateModel.updateMany(
        { organizationId: ctx.organizationId, ...(existingId ? { _id: { $ne: existingId } } : {}) },
        { isDefault: false },
      );
    }
    return input;
  },
});

interface TemplateLike {
  _id: Types.ObjectId;
  tasks: { title: string; description?: string | null; category?: string | null; assignee?: string | null; dueInDays?: number | null; required?: boolean | null }[];
}
interface EmployeeLike {
  _id: Types.ObjectId;
  managerId?: Types.ObjectId | null;
  userId?: Types.ObjectId | null;
  firstName: string;
  lastName: string;
}

export const startOnboardingInSession = async (
  ctx: RequestContext,
  employee: EmployeeLike,
  template: TemplateLike,
  startDateKey: string,
  session?: ClientSession,
  candidateId?: Types.ObjectId,
) => {
  const [onboarding] = await OnboardingModel.create(
    [
      {
        organizationId: ctx.organizationId,
        employeeId: employee._id,
        templateId: template._id,
        candidateId: candidateId ?? null,
        startDate: dateOnly(startDateKey),
        status: 'PENDING',
        tasks: template.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          category: t.category,
          assignee: t.assignee,
          required: t.required ?? true,
          dueDate: dateOnly(addDaysKey(startDateKey, t.dueInDays ?? 0)),
        })),
        progress: 0,
        createdBy: ctx.userId,
      },
    ],
    { session },
  );
  return onboarding!;
};

export const startOnboarding = async (ctx: RequestContext, input: { employeeId: string; templateId: string; startDate?: string }) => {
  const [employee, template] = await Promise.all([
    EmployeeModel.findOne({ _id: input.employeeId, organizationId: ctx.organizationId, deletedAt: null }).lean(),
    OnboardingTemplateModel.findOne({ _id: input.templateId, organizationId: ctx.organizationId, deletedAt: null }).lean(),
  ]);
  if (!employee) throw notFound('Employee');
  if (!template) throw notFound('Onboarding template');
  if (await OnboardingModel.exists({ organizationId: ctx.organizationId, employeeId: employee._id, status: { $ne: 'COMPLETED' } })) {
    throw conflict('This employee already has an active onboarding');
  }
  const onboarding = await startOnboardingInSession(ctx, employee, template, input.startDate ?? toDateKey(employee.joiningDate));
  await notify({
    organizationId: ctx.organizationId,
    userIds: [employee.userId, await managerUserId(ctx.organizationId, employee.managerId)],
    type: 'ONBOARDING',
    title: 'Onboarding started',
    message: `Onboarding checklist created for ${employee.firstName} ${employee.lastName}.`,
    link: `/onboarding/${onboarding._id}`,
    excludeUserId: ctx.userId,
  });
  return onboarding.toJSON();
};

const accessFilter = async (ctx: RequestContext): Promise<FilterQuery<Onboarding>> => {
  if (can(ctx, 'onboarding:manage')) return {};
  if (!ctx.employeeId) return { _id: { $in: [] } };
  // Same rule as task updates: self plus direct and indirect reports.
  const reports = await getReportIds(ctx.organizationId, ctx.employeeId);
  return { employeeId: { $in: [ctx.employeeId, ...reports] } };
};

export const listOnboardings = async (ctx: RequestContext, q: PaginationQuery & { status?: string }) => {
  // Access restriction and search are combined with $and so a search can never widen the scope.
  const clauses: FilterQuery<Onboarding>[] = [{ organizationId: ctx.organizationId }, await accessFilter(ctx)];
  if (q.status) clauses.push({ status: q.status });
  if (q.search) {
    const re = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const emps = await EmployeeModel.find({ organizationId: ctx.organizationId, $or: [{ firstName: re }, { lastName: re }, { employeeId: re }] }).select('_id').lean();
    clauses.push({ employeeId: { $in: emps.map((e) => e._id) } });
  }
  const filter: FilterQuery<Onboarding> = { $and: clauses };
  const [items, total] = await Promise.all([
    OnboardingModel.find(filter)
      .populate({ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto joiningDate departmentId designationId', populate: [{ path: 'departmentId', select: 'name' }, { path: 'designationId', select: 'name' }] })
      .populate({ path: 'templateId', select: 'name' })
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    OnboardingModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

export const getOnboarding = async (ctx: RequestContext, id: string) => {
  const doc = await OnboardingModel.findOne({ _id: id, organizationId: ctx.organizationId, ...(await accessFilter(ctx)) })
    .populate({ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto joiningDate managerId workEmail' })
    .populate({ path: 'templateId', select: 'name' })
    .populate({ path: 'tasks.completedBy', select: 'firstName lastName' })
    .lean();
  if (!doc) throw notFound('Onboarding');
  return doc;
};

export const updateOnboardingTask = async (
  ctx: RequestContext,
  id: string,
  taskId: string,
  input: { status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'; note?: string },
) => {
  const doc = await OnboardingModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound('Onboarding');
  const task = doc.tasks.id(taskId);
  if (!task) throw notFound('Task');

  const isSelf = ctx.employeeId?.equals(doc.employeeId);
  const allowed =
    can(ctx, 'onboarding:manage') ||
    (isSelf && task.assignee === 'EMPLOYEE') ||
    (task.assignee === 'MANAGER' && (await isManagerOf(ctx, doc.employeeId)));
  if (!allowed) throw forbidden('You cannot update this task');

  task.status = input.status;
  if (input.note !== undefined) task.note = input.note;
  task.completedAt = input.status === 'COMPLETED' ? new Date() : undefined;
  task.completedBy = input.status === 'COMPLETED' ? ctx.userId : null;

  const done = doc.tasks.filter((t) => t.status === 'COMPLETED').length;
  doc.progress = doc.tasks.length ? Math.round((done / doc.tasks.length) * 100) : 100;
  const requiredOpen = doc.tasks.some((t) => t.required && t.status !== 'COMPLETED');
  doc.status = !requiredOpen ? 'COMPLETED' : doc.tasks.some((t) => t.status !== 'PENDING') ? 'IN_PROGRESS' : 'PENDING';
  doc.completedAt = doc.status === 'COMPLETED' ? (doc.completedAt ?? new Date()) : undefined;
  await doc.save();
  return getOnboarding(ctx, id);
};
