import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';
import type { z } from 'zod';
import {
  EXPENSE_WORKFLOW,
  type ApproverType,
  type ExpenseStatus,
  type PaginationQuery,
  type expensePaySchema,
  type expenseSchema,
  type expenseUpdateSchema,
} from '@stencil/shared';
import { EmployeeModel, ExpenseModel, OrganizationModel, type Expense } from '../models';
import { can, type RequestContext } from '../types/context';
import { formatSequence, nextSequence } from '../utils/counter';
import { dateOnly, todayKey } from '../utils/dates';
import { badRequest, forbidden, invalidTransition, notFound } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import {
  applyDecision,
  approvalQueueFilter,
  canActOnStep,
  closeApproval,
  initApproval,
  type Approvable,
  type ApprovalPolicy,
} from './approval.service';
import { audit, diff } from './audit.service';
import { assertAttachment } from './document.service';
import { managerUserId, notify, notifyHr, userIdsForEmployees, userIdsWithPermission } from './notification.service';
import { applyScope, assertEmployeeAccess, resolveEmployeeScope } from './scope.service';

type ExpenseCreate = z.output<typeof expenseSchema>;
type ExpenseUpdate = z.output<typeof expenseUpdateSchema>;
type ExpensePay = z.output<typeof expensePaySchema>;
type ExpenseDoc = HydratedDocument<Expense>;

type ExpenseListQuery = PaginationQuery & {
  scope?: 'me' | 'team' | 'all' | 'approvals' | 'payable';
  status?: string;
  category?: string;
  from?: string;
  to?: string;
  employeeId?: string;
};

/**
 * HR-type steps are actionable by `expense:read` holders; FINANCE steps by
 * `expense:pay` holders.
 */
export const EXPENSE_POLICY: ApprovalPolicy = {
  approvePermission: 'expense:approve',
  rejectPermission: 'expense:reject',
  hrPermission: 'expense:read',
  financePermission: 'expense:pay',
};
const DEFAULT_CHAIN: ApproverType[] = ['MANAGER', 'FINANCE'];
const PENDING: ExpenseStatus[] = ['SUBMITTED', 'PENDING_APPROVAL'];

const approvable = (doc: ExpenseDoc) => doc as unknown as Approvable;

const assertTransition = (from: ExpenseStatus, to: ExpenseStatus) => {
  if (!EXPENSE_WORKFLOW.can(from, to)) throw invalidTransition('Expense', from, to);
};

const loadExpense = async (ctx: RequestContext, id: string) => {
  const doc = await ExpenseModel.findOne({ _id: id, organizationId: ctx.organizationId });
  if (!doc) throw notFound('Expense');
  return doc;
};

const loadEmployee = async (ctx: RequestContext, id: Types.ObjectId | string) => {
  const emp = await EmployeeModel.findOne({ _id: id, organizationId: ctx.organizationId }).select('firstName lastName employeeId managerId userId').lean();
  if (!emp) throw notFound('Employee');
  return emp;
};

const isOwner = (ctx: RequestContext, doc: { employeeId: Types.ObjectId; createdBy?: Types.ObjectId | null }) =>
  !!ctx.employeeId?.equals(doc.employeeId) || (!!doc.createdBy && ctx.userId.equals(doc.createdBy));

const label = (doc: { expenseNumber: string; amount: number; currency: string }) => `${doc.expenseNumber} (${doc.currency} ${doc.amount})`;

/** Users who can act on the expense's current approval step. */
const currentApproverUserIds = async (ctx: RequestContext, doc: ExpenseDoc, managerId: Types.ObjectId | null | undefined) => {
  switch (doc.currentApproverType) {
    case 'MANAGER': {
      const mgr = await managerUserId(ctx.organizationId, managerId);
      return mgr ? [mgr] : userIdsWithPermission(ctx.organizationId, EXPENSE_POLICY.hrPermission);
    }
    case 'HR':
      return userIdsWithPermission(ctx.organizationId, EXPENSE_POLICY.hrPermission);
    case 'FINANCE':
      return userIdsWithPermission(ctx.organizationId, 'expense:pay');
    default:
      return [];
  }
};

const notifyApprovers = async (ctx: RequestContext, doc: ExpenseDoc, employee: { managerId?: Types.ObjectId | null; userId?: Types.ObjectId | null; firstName: string; lastName: string }) => {
  const ids = (await currentApproverUserIds(ctx, doc, employee.managerId)).filter((id) => !employee.userId || !employee.userId.equals(id));
  await notify({
    organizationId: ctx.organizationId,
    userIds: ids,
    type: 'EXPENSE_APPROVAL',
    title: 'Expense awaiting approval',
    message: `${employee.firstName} ${employee.lastName} submitted ${label(doc)}: ${doc.description}`,
    link: `/expenses/${String(doc._id)}`,
    entityType: 'Expense',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
  return ids;
};

/** A new expense claim: HR hears about it too (in-app), beyond whoever approves it. */
const informHr = (
  ctx: RequestContext,
  doc: ExpenseDoc,
  employee: { userId?: Types.ObjectId | null; firstName: string; lastName: string },
  alreadyNotified: Types.ObjectId[],
) =>
  notifyHr({
    organizationId: ctx.organizationId,
    alreadyNotified: [...alreadyNotified, employee.userId],
    type: 'EXPENSE_APPROVAL',
    title: `New expense claim · ${employee.firstName} ${employee.lastName}`.trim(),
    message: `${label(doc)}: ${doc.description}`,
    link: `/expenses/${String(doc._id)}`,
    entityType: 'Expense',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });

const notifyEmployee = async (ctx: RequestContext, doc: ExpenseDoc, title: string, message: string) => {
  await notify({
    organizationId: ctx.organizationId,
    userIds: await userIdsForEmployees(ctx.organizationId, [doc.employeeId]),
    type: 'EXPENSE_APPROVAL',
    title,
    message,
    link: `/expenses/${String(doc._id)}`,
    entityType: 'Expense',
    entityId: doc._id,
    excludeUserId: ctx.userId,
  });
};

const approvalChain = async (ctx: RequestContext): Promise<ApproverType[]> => {
  const org = await OrganizationModel.findById(ctx.organizationId).select('settings.approvals').lean();
  const chain = (org?.settings?.approvals?.expense ?? []) as ApproverType[];
  return chain.length ? chain : DEFAULT_CHAIN;
};

const assertNotFuture = (ctx: RequestContext, date: string) => {
  if (date > todayKey(ctx.timezone)) {
    throw badRequest('Expense date cannot be in the future', 'VALIDATION_ERROR', [{ path: 'date', message: 'Cannot be in the future' }]);
  }
};

/** Moves a draft into the approval workflow (caller saves). */
const beginApproval = async (ctx: RequestContext, doc: ExpenseDoc, employee: { _id: Types.ObjectId; managerId?: Types.ObjectId | null }) => {
  assertTransition(doc.status as ExpenseStatus, 'SUBMITTED');
  initApproval(approvable(doc), await approvalChain(ctx), employee);
  doc.status = 'SUBMITTED';
  doc.submittedAt = new Date();
  doc.rejectionReason = undefined;
};

/* ------------------------------- Queries ------------------------------ */

export const listExpenses = async (ctx: RequestContext, q: ExpenseListQuery) => {
  const filter: FilterQuery<Expense> = { organizationId: ctx.organizationId };
  const and: FilterQuery<Expense>[] = [];
  if (q.scope === 'approvals') {
    const queue = await approvalQueueFilter(ctx, EXPENSE_POLICY);
    if (!queue) return { items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
    filter.status = { $in: PENDING };
    and.push(queue);
  } else if (q.scope === 'payable') {
    if (!can(ctx, 'expense:pay')) throw forbidden();
    filter.status = 'APPROVED';
  } else {
    const scope = await resolveEmployeeScope(ctx, 'expense:read', q.scope);
    Object.assign(filter, applyScope({}, scope));
  }
  if (q.status && q.scope !== 'payable') {
    if (q.scope === 'approvals' && !PENDING.includes(q.status as ExpenseStatus)) return { items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 1 } };
    filter.status = q.status;
  }
  if (q.category) filter.category = q.category;
  if (q.employeeId) {
    const id = new Types.ObjectId(q.employeeId);
    if (filter.employeeId) and.push({ employeeId: id });
    else filter.employeeId = id;
  }
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(q.to ? { $lte: dateOnly(q.to) } : {}) };
  if (q.search) and.push(searchFilter(q.search, ['expenseNumber', 'description', 'merchant', 'project']));
  if (and.length) filter.$and = and;

  return paginate(ExpenseModel, {
    filter,
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['date', 'amount', 'status', 'expenseNumber', 'createdAt', 'submittedAt'], { createdAt: -1 }),
    populate: [{ path: 'employeeId', select: 'employeeId firstName lastName profilePhoto' }],
  });
};

/** IDOR: owner, `expense:read`, managers (team), current-step approvers and payers. */
const assertCanView = async (ctx: RequestContext, doc: ExpenseDoc, employee: { _id: Types.ObjectId; managerId?: Types.ObjectId | null }) => {
  if (isOwner(ctx, doc)) return;
  try {
    await assertEmployeeAccess(ctx, doc.employeeId, 'expense:read');
    return;
  } catch (err) {
    if (can(ctx, 'expense:pay') && doc.status !== 'DRAFT') return;
    const step = doc.approvalSteps[doc.currentStep];
    if (step?.status === 'PENDING' && PENDING.includes(doc.status as ExpenseStatus)) {
      if (await canActOnStep(ctx, step as never, employee, EXPENSE_POLICY, 'APPROVE')) return;
    }
    throw err;
  }
};

export const getExpense = async (ctx: RequestContext, id: string) => {
  const doc = await loadExpense(ctx, id);
  const employee = await loadEmployee(ctx, doc.employeeId);
  await assertCanView(ctx, doc, employee);
  const full = await ExpenseModel.findById(doc._id)
    .populate([
      { path: 'employeeId', select: 'employeeId firstName lastName profilePhoto departmentId designationId' },
      { path: 'receiptFileId', select: 'title originalName mimeType size createdAt' },
      { path: 'paidBy', select: 'firstName lastName' },
      { path: 'createdBy', select: 'firstName lastName' },
    ])
    .lean();
  const step = doc.approvalSteps[doc.currentStep];
  const canAct = !!step && step.status === 'PENDING' && PENDING.includes(doc.status as ExpenseStatus)
    ? await canActOnStep(ctx, step as never, employee, EXPENSE_POLICY, 'APPROVE')
    : false;
  return {
    ...full,
    receiptUrl: doc.receiptFileId ? `/api/v1/files/${String(doc.receiptFileId)}` : null,
    permissions: {
      canApprove: canAct,
      canEdit: isOwner(ctx, doc) && doc.status === 'DRAFT',
      canCancel: isOwner(ctx, doc) && EXPENSE_WORKFLOW.can(doc.status as ExpenseStatus, 'CANCELLED'),
      canPay: doc.status === 'APPROVED' && can(ctx, 'expense:pay') && !ctx.employeeId?.equals(doc.employeeId),
    },
  };
};

export const expenseSummary = async (ctx: RequestContext, q: { from?: string; to?: string; scope?: 'me' | 'team' | 'all' }) => {
  const scope = await resolveEmployeeScope(ctx, 'expense:read', q.scope);
  const match: FilterQuery<Expense> = applyScope({ organizationId: ctx.organizationId }, scope);
  if (q.from || q.to) match.date = { ...(q.from ? { $gte: dateOnly(q.from) } : {}), ...(q.to ? { $lte: dateOnly(q.to) } : {}) };
  const group = (key: string) =>
    ExpenseModel.aggregate<{ _id: { key: string; currency: string }; count: number; total: number }>([
      { $match: match },
      { $group: { _id: { key: `$${key}`, currency: '$currency' }, count: { $sum: 1 }, total: { $sum: '$amount' } } },
      { $sort: { '_id.key': 1 } },
    ]);
  const [byStatus, byCategory] = await Promise.all([group('status'), group('category')]);
  const totals = new Map<string, { currency: string; count: number; total: number }>();
  for (const r of byStatus) {
    const t = totals.get(r._id.currency) ?? { currency: r._id.currency, count: 0, total: 0 };
    t.count += r.count;
    t.total += r.total;
    totals.set(r._id.currency, t);
  }
  return {
    from: q.from ?? null,
    to: q.to ?? null,
    byStatus: byStatus.map((r) => ({ status: r._id.key, currency: r._id.currency, count: r.count, total: r.total })),
    byCategory: byCategory.map((r) => ({ category: r._id.key, currency: r._id.currency, count: r.count, total: r.total })),
    totals: [...totals.values()],
  };
};

/* ------------------------------ Mutations ----------------------------- */

export const createExpense = async (ctx: RequestContext, input: ExpenseCreate) => {
  const onBehalf = !!input.employeeId && !ctx.employeeId?.equals(input.employeeId);
  if (onBehalf && !can(ctx, 'expense:create')) throw forbidden('You can only submit your own expenses');
  const targetId = input.employeeId ?? ctx.employeeId;
  if (!targetId) throw badRequest('Your account is not linked to an employee profile', 'NO_EMPLOYEE_PROFILE');
  const employee = await EmployeeModel.findOne({
    _id: targetId,
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
  })
    .select('firstName lastName employeeId managerId userId')
    .lean();
  if (!employee) throw badRequest('Employee not found', 'INVALID_REFERENCE', [{ path: 'employeeId', message: 'Employee not found' }]);
  assertNotFuture(ctx, input.date);
  if (input.receiptFileId) await assertAttachment(ctx, input.receiptFileId, { employeeId: employee._id, label: 'Receipt', path: 'receiptFileId' });

  const doc = await withTransaction(async (session) => {
    const seq = await nextSequence(ctx.organizationId, 'expense', session);
    const doc = new ExpenseModel({
      organizationId: ctx.organizationId,
      expenseNumber: formatSequence('EXP-', seq),
      employeeId: employee._id,
      category: input.category,
      amount: input.amount,
      currency: input.currency,
      date: dateOnly(input.date),
      description: input.description,
      merchant: input.merchant,
      project: input.project,
      receiptFileId: input.receiptFileId ?? null,
      status: 'DRAFT',
      createdBy: ctx.userId,
    });
    if (input.submit) await beginApproval(ctx, doc, employee);
    await doc.save({ session });
    return doc;
  });

  if (doc.status === 'SUBMITTED') {
    await audit(ctx, { action: 'EXPENSE_SUBMITTED', module: 'expenses', recordId: doc._id, recordLabel: label(doc), newValues: { status: 'SUBMITTED', amount: doc.amount, category: doc.category } });
    await informHr(ctx, doc, employee, await notifyApprovers(ctx, doc, employee));
  } else {
    await audit(ctx, { action: 'RECORD_CREATED', module: 'expenses', recordId: doc._id, recordLabel: label(doc), newValues: { status: 'DRAFT', amount: doc.amount } });
  }
  return getExpense(ctx, String(doc._id));
};

export const updateExpense = async (ctx: RequestContext, id: string, input: ExpenseUpdate) => {
  const doc = await loadExpense(ctx, id);
  if (!isOwner(ctx, doc)) throw forbidden('Only the owner can edit this expense');
  if (doc.status !== 'DRAFT') throw invalidTransition('Expense', doc.status, 'DRAFT');
  if (input.date) assertNotFuture(ctx, input.date);
  if (input.receiptFileId) await assertAttachment(ctx, input.receiptFileId, { employeeId: doc.employeeId, label: 'Receipt', path: 'receiptFileId' });
  const before = doc.toObject() as unknown as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) changes[k] = k === 'date' ? dateOnly(v as string) : v;
  doc.set(changes);
  await doc.save();
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'expenses', recordId: doc._id, recordLabel: label(doc), ...diff(before, changes) });
  return getExpense(ctx, id);
};

export const submitExpense = async (ctx: RequestContext, id: string) => {
  const doc = await loadExpense(ctx, id);
  if (!isOwner(ctx, doc)) throw forbidden('Only the owner can submit this expense');
  const employee = await loadEmployee(ctx, doc.employeeId);
  await beginApproval(ctx, doc, employee);
  await doc.save();
  await audit(ctx, { action: 'EXPENSE_SUBMITTED', module: 'expenses', recordId: doc._id, recordLabel: label(doc), oldValues: { status: 'DRAFT' }, newValues: { status: 'SUBMITTED' } });
  await informHr(ctx, doc, employee, await notifyApprovers(ctx, doc, employee));
  return getExpense(ctx, id);
};

export const approveExpense = async (ctx: RequestContext, id: string, comment?: string) => {
  const doc = await loadExpense(ctx, id);
  const from = doc.status as ExpenseStatus;
  if (!PENDING.includes(from)) throw invalidTransition('Expense', from, 'APPROVED');
  const employee = await loadEmployee(ctx, doc.employeeId);
  const outcome = await applyDecision(ctx, approvable(doc), employee, EXPENSE_POLICY, 'APPROVE', comment);
  const to: ExpenseStatus = outcome === 'APPROVED' ? 'APPROVED' : 'PENDING_APPROVAL';
  if (to !== from) assertTransition(from, to);
  doc.status = to;
  if (to === 'APPROVED') doc.approvedAt = new Date();
  await doc.save();

  await audit(ctx, {
    action: 'EXPENSE_APPROVED',
    module: 'expenses',
    recordId: doc._id,
    recordLabel: label(doc),
    oldValues: { status: from },
    newValues: { status: to, step: doc.approvalSteps.filter((s) => s.status === 'APPROVED').length, comment },
  });
  if (to === 'APPROVED') {
    await notifyEmployee(ctx, doc, 'Expense approved', `${label(doc)} has been approved and is awaiting payment`);
    await notify({
      organizationId: ctx.organizationId,
      userIds: (await userIdsWithPermission(ctx.organizationId, 'expense:pay')).filter((u) => !employee.userId?.equals(u)),
      type: 'EXPENSE_APPROVAL',
      title: 'Expense ready for payment',
      message: `${label(doc)} for ${employee.firstName} ${employee.lastName} is approved and awaiting payment`,
      link: `/expenses/${String(doc._id)}`,
      entityType: 'Expense',
      entityId: doc._id,
      excludeUserId: ctx.userId,
    });
  } else {
    await notifyApprovers(ctx, doc, employee);
  }
  return getExpense(ctx, id);
};

export const rejectExpense = async (ctx: RequestContext, id: string, reason: string) => {
  const doc = await loadExpense(ctx, id);
  const from = doc.status as ExpenseStatus;
  if (!PENDING.includes(from)) throw invalidTransition('Expense', from, 'REJECTED');
  const employee = await loadEmployee(ctx, doc.employeeId);
  await applyDecision(ctx, approvable(doc), employee, EXPENSE_POLICY, 'REJECT', reason);
  assertTransition(from, 'REJECTED');
  doc.status = 'REJECTED';
  doc.rejectionReason = reason;
  await doc.save();
  await audit(ctx, { action: 'EXPENSE_REJECTED', module: 'expenses', recordId: doc._id, recordLabel: label(doc), oldValues: { status: from }, newValues: { status: 'REJECTED', reason } });
  await notifyEmployee(ctx, doc, 'Expense rejected', `${label(doc)} was rejected: ${reason}`);
  return getExpense(ctx, id);
};

export const cancelExpense = async (ctx: RequestContext, id: string) => {
  const doc = await loadExpense(ctx, id);
  if (!isOwner(ctx, doc)) throw forbidden('Only the owner can cancel this expense');
  const from = doc.status as ExpenseStatus;
  assertTransition(from, 'CANCELLED');
  closeApproval(approvable(doc));
  doc.status = 'CANCELLED';
  await doc.save();
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'expenses', recordId: doc._id, recordLabel: label(doc), oldValues: { status: from }, newValues: { status: 'CANCELLED' } });
  return getExpense(ctx, id);
};

export const payExpense = async (ctx: RequestContext, id: string, input: ExpensePay) => {
  const doc = await loadExpense(ctx, id);
  if (ctx.employeeId?.equals(doc.employeeId)) throw forbidden('You cannot pay your own expense');
  const from = doc.status as ExpenseStatus;
  assertTransition(from, 'PAID');
  // Conditional write so an expense is never paid twice.
  const res = await ExpenseModel.updateOne(
    { _id: doc._id, organizationId: ctx.organizationId, status: 'APPROVED' },
    { status: 'PAID', paidAt: dateOnly(input.paidDate), paidBy: ctx.userId, paymentReference: input.paymentReference },
  );
  if (!res.modifiedCount) throw invalidTransition('Expense', from, 'PAID');
  doc.status = 'PAID';
  await audit(ctx, {
    action: 'EXPENSE_PAID',
    module: 'expenses',
    recordId: doc._id,
    recordLabel: label(doc),
    oldValues: { status: from },
    newValues: { status: 'PAID', paidDate: input.paidDate, paymentReference: input.paymentReference },
  });
  await notifyEmployee(ctx, doc, 'Expense paid', `${label(doc)} has been paid${input.paymentReference ? ` (ref ${input.paymentReference})` : ''}`);
  return getExpense(ctx, id);
};
