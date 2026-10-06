import type { z } from 'zod';
import type { leaveTypeListQuery, leaveTypeSchema, leaveTypeUpdateSchema } from '@stencil/shared';
import { LeaveRequestModel, LeaveTypeModel } from '../models';
import type { RequestContext } from '../types/context';
import { conflict, notFound, unprocessable } from '../utils/errors';
import { audit, diff } from './audit.service';
import { createCrudService } from './crud.service';

type LeaveTypeCreate = z.output<typeof leaveTypeSchema>;
type LeaveTypeUpdate = z.output<typeof leaveTypeUpdateSchema>;
type LeaveTypeListQuery = z.output<typeof leaveTypeListQuery>;

const crud = createCrudService({
  model: LeaveTypeModel,
  entity: 'Leave type',
  module: 'leave',
  searchFields: ['name', 'code'],
  sortFields: ['name', 'code', 'annualAllowance', 'createdAt'],
  defaultSort: { name: 1 },
});

/** Codes are unique per organization, including archived types (unique index). */
const assertCodeFree = async (ctx: RequestContext, code: string | undefined, exceptId?: string) => {
  if (!code) return;
  const clash = await LeaveTypeModel.exists({
    organizationId: ctx.organizationId,
    code: code.toUpperCase(),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  if (clash) throw conflict(`A leave type with code ${code.toUpperCase()} already exists`, 'CODE_TAKEN');
};

export const listLeaveTypes = (ctx: RequestContext, q: LeaveTypeListQuery) =>
  crud.list(ctx, q, q.active ? { active: q.active === 'true' } : {});

/** Active leave types for pickers (any authenticated user). */
export const allLeaveTypes = (ctx: RequestContext) => crud.all(ctx, { active: true });

export const getLeaveType = (ctx: RequestContext, id: string) => crud.get(ctx, id);

/**
 * Creates a leave type. Balances are not created eagerly: `ensureLeaveBalances`
 * creates them lazily the first time an employee's balances are read or used.
 */
export const createLeaveType = async (ctx: RequestContext, input: LeaveTypeCreate) => {
  await assertCodeFree(ctx, input.code);
  return crud.create(ctx, input as unknown as Record<string, unknown>);
};

export const updateLeaveType = async (ctx: RequestContext, id: string, input: LeaveTypeUpdate) => {
  const existing = await LeaveTypeModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).lean();
  if (!existing) throw notFound('Leave type');
  await assertCodeFree(ctx, input.code, id);
  if (input.active === false && existing.active) await assertNoPendingRequests(ctx, id, 'deactivate');
  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  return crud.update(ctx, id, data);
};

const assertNoPendingRequests = async (ctx: RequestContext, id: string, verb: string) => {
  const pending = await LeaveRequestModel.countDocuments({
    organizationId: ctx.organizationId,
    leaveTypeId: id,
    status: { $in: ['SUBMITTED', 'PENDING_APPROVAL'] },
  });
  if (pending) {
    throw unprocessable(`Cannot ${verb} this leave type: ${pending} request(s) are awaiting approval`, 'LEAVE_TYPE_IN_USE');
  }
};

/** Soft delete (archive). Blocked while requests of this type await approval. */
export const archiveLeaveType = async (ctx: RequestContext, id: string) => {
  const doc = await LeaveTypeModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!doc) throw notFound('Leave type');
  await assertNoPendingRequests(ctx, id, 'archive');
  const before = { active: doc.active, deletedAt: doc.deletedAt };
  doc.active = false;
  doc.deletedAt = new Date();
  await doc.save();
  await audit(ctx, {
    action: 'RECORD_DELETED',
    module: 'leave',
    recordId: doc._id,
    recordLabel: `${doc.name} (${doc.code})`,
    ...diff(before, { active: false, deletedAt: doc.deletedAt }),
  });
};
