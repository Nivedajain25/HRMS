import { Types, type FilterQuery } from 'mongoose';
import type { z } from 'zod';
import {
  ASSET_WORKFLOW,
  type AssetStatus,
  type PaginationQuery,
  type assetAssignSchema,
  type assetReturnSchema,
  type assetSchema,
  type assetStatusSchema,
  type assetUpdateSchema,
} from '@stencil/shared';
import { AssetAssignmentModel, AssetModel, EmployeeModel, type Asset, type AssetAssignment } from '../models';
import { can, type RequestContext } from '../types/context';
import { formatSequence, nextSequence } from '../utils/counter';
import { dateOnly } from '../utils/dates';
import { badRequest, conflict, forbidden, invalidTransition, notFound, unprocessable } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { withTransaction } from '../utils/transaction';
import { audit, diff } from './audit.service';
import { notify, userIdsForEmployees } from './notification.service';
import { assertRefsInOrg } from './refs.service';
import { applyScope, resolveEmployeeScope } from './scope.service';

type AssetInput = z.output<typeof assetSchema>;
/** `undefined` = unchanged, `null` = clear. */
type AssetUpdate = z.output<typeof assetUpdateSchema>;
type AssignInput = z.output<typeof assetAssignSchema>;
type ReturnInput = z.output<typeof assetReturnSchema>;
type StatusInput = z.output<typeof assetStatusSchema>;

type AssetListQuery = PaginationQuery & {
  scope?: 'me' | 'team' | 'all';
  status?: string;
  category?: string;
  locationId?: string;
};
type AssignmentListQuery = PaginationQuery & {
  scope?: 'me' | 'team' | 'all';
  employeeId?: string;
  assetId?: string;
  status?: 'ACTIVE' | 'RETURNED';
};

const ACTIVE_EMPLOYEE = { $nin: ['EXITED', 'ARCHIVED'] };
const EMPLOYEE_SELECT = 'employeeId firstName lastName profilePhoto workEmail';

const toDate = (v: string | undefined | null) => (v ? dateOnly(v) : v === null ? null : undefined);

const label = (a: { assetTag: string; name: string }) => `${a.assetTag} ${a.name}`;

const assertTransition = (from: AssetStatus, to: AssetStatus) => {
  if (!ASSET_WORKFLOW.can(from, to)) throw invalidTransition('Asset', from, to);
};

const loadAsset = async (ctx: RequestContext, id: string, session?: import('mongoose').ClientSession) => {
  const asset = await AssetModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null }).session(session ?? null);
  if (!asset) throw notFound('Asset');
  return asset;
};

const assertTagFree = async (ctx: RequestContext, tag: string, exceptId?: Types.ObjectId) => {
  const taken = await AssetModel.exists({ organizationId: ctx.organizationId, assetTag: tag, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
  if (taken) throw conflict(`Asset tag ${tag} is already in use`, 'ASSET_TAG_TAKEN');
};

/** Next free `AST-0001` style tag (skips tags that were entered manually). */
const generateTag = async (ctx: RequestContext) => {
  for (let i = 0; i < 20; i += 1) {
    const tag = formatSequence('AST-', await nextSequence(ctx.organizationId, 'asset'));
    if (!(await AssetModel.exists({ organizationId: ctx.organizationId, assetTag: tag }))) return tag;
  }
  throw conflict('Could not generate a unique asset tag; please enter one', 'ASSET_TAG_TAKEN');
};

/* ------------------------------- Queries ------------------------------ */

export const listAssets = async (ctx: RequestContext, q: AssetListQuery) => {
  const scope = await resolveEmployeeScope(ctx, 'asset:read', q.scope);
  const filter: FilterQuery<Asset> = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...searchFilter(q.search, ['assetTag', 'name', 'serialNumber', 'brand', 'model']),
  };
  if (q.status) filter.status = q.status;
  if (q.category) filter.category = q.category;
  if (q.locationId) filter.locationId = new Types.ObjectId(q.locationId);
  return paginate(AssetModel, {
    filter: applyScope(filter, scope, 'currentEmployeeId'),
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['assetTag', 'name', 'category', 'status', 'purchaseDate', 'createdAt'], { assetTag: 1 }),
    populate: [
      { path: 'currentEmployeeId', select: EMPLOYEE_SELECT },
      { path: 'locationId', select: 'name city' },
    ],
  });
};

/** Assets currently assigned to the caller, with assignment details. */
export const myAssets = async (ctx: RequestContext) => {
  if (!ctx.employeeId) return [];
  return AssetAssignmentModel.find({ organizationId: ctx.organizationId, employeeId: ctx.employeeId, status: 'ACTIVE' })
    .populate({ path: 'assetId', select: 'assetTag name category brand model serialNumber condition status' })
    .sort({ assignedDate: -1 })
    .lean();
};

export const getAsset = async (ctx: RequestContext, id: string) => {
  const asset = await AssetModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null })
    .populate([
      { path: 'currentEmployeeId', select: EMPLOYEE_SELECT },
      { path: 'locationId', select: 'name city' },
    ])
    .lean();
  if (!asset) throw notFound('Asset');
  const readAll = can(ctx, 'asset:read');
  const holder = asset.currentEmployeeId as unknown as { _id: Types.ObjectId } | null;
  const mine = !!ctx.employeeId && !!holder && ctx.employeeId.equals(holder._id);
  if (!readAll && !mine) throw forbidden('You do not have access to this asset');

  const assignments = await AssetAssignmentModel.find({
    organizationId: ctx.organizationId,
    assetId: asset._id,
    ...(readAll ? {} : { employeeId: ctx.employeeId }),
  })
    .populate([
      { path: 'employeeId', select: EMPLOYEE_SELECT },
      { path: 'assignedBy', select: 'firstName lastName' },
      { path: 'returnedTo', select: 'firstName lastName' },
    ])
    .sort({ assignedDate: -1, createdAt: -1 })
    .lean();
  return { ...asset, statusHistory: readAll ? asset.statusHistory : [], assignments };
};

export const listAssignments = async (ctx: RequestContext, q: AssignmentListQuery) => {
  const scope = await resolveEmployeeScope(ctx, 'asset:read', q.scope);
  const filter: FilterQuery<AssetAssignment> = { organizationId: ctx.organizationId };
  if (q.status) filter.status = q.status;
  if (q.assetId) filter.assetId = new Types.ObjectId(q.assetId);
  if (q.employeeId) {
    const id = new Types.ObjectId(q.employeeId);
    if (scope.employeeIds !== null && !scope.employeeIds.some((e) => e.equals(id))) throw forbidden('You do not have access to this record');
    filter.employeeId = id;
  }
  if (q.search) {
    // Match on the asset (tag / name / serial) or the employee (name / code).
    const [assetMatches, employeeMatches] = await Promise.all([
      AssetModel.find({ organizationId: ctx.organizationId, ...searchFilter(q.search, ['assetTag', 'name', 'serialNumber']) })
        .select('_id')
        .lean(),
      EmployeeModel.find({ organizationId: ctx.organizationId, ...searchFilter(q.search, ['firstName', 'lastName', 'employeeId']) })
        .select('_id')
        .lean(),
    ]);
    filter.$and = [
      {
        $or: [
          { assetId: { $in: assetMatches.map((a) => a._id) } },
          { employeeId: { $in: employeeMatches.map((e) => e._id) } },
        ],
      },
    ];
  }
  return paginate(AssetAssignmentModel, {
    filter: applyScope(filter, scope),
    page: q.page,
    limit: q.limit,
    sort: buildSort(q, ['assignedDate', 'returnedDate', 'createdAt'], { assignedDate: -1, createdAt: -1 }),
    populate: [
      { path: 'assetId', select: 'assetTag name category serialNumber status' },
      { path: 'employeeId', select: EMPLOYEE_SELECT },
    ],
  });
};

export const assetSummary = async (ctx: RequestContext) => {
  const match = { organizationId: ctx.organizationId, deletedAt: null };
  const [byStatus, byCategory, totals] = await Promise.all([
    AssetModel.aggregate<{ _id: string; count: number; value: number }>([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$purchaseCost', 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    AssetModel.aggregate<{ _id: string; count: number; value: number }>([
      { $match: match },
      { $group: { _id: '$category', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$purchaseCost', 0] } } } },
      { $sort: { count: -1 } },
    ]),
    AssetModel.aggregate<{ count: number; value: number }>([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: { $ifNull: ['$purchaseCost', 0] } } } },
    ]),
  ]);
  return {
    total: totals[0]?.count ?? 0,
    totalValue: totals[0]?.value ?? 0,
    currency: ctx.currency,
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count, value: s.value })),
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.count, value: c.value })),
  };
};

/* ------------------------------ Mutations ----------------------------- */

export const createAsset = async (ctx: RequestContext, input: AssetInput) => {
  await assertRefsInOrg(ctx.organizationId, input, ['locationId']);
  const assetTag = input.assetTag ?? (await generateTag(ctx));
  if (input.assetTag) await assertTagFree(ctx, assetTag);
  const { purchaseDate, warrantyExpiry, assetTag: _tag, ...fields } = input;
  void _tag;
  const asset = await AssetModel.create({
    ...fields,
    organizationId: ctx.organizationId,
    assetTag,
    purchaseDate: toDate(purchaseDate),
    warrantyExpiry: toDate(warrantyExpiry),
    status: 'AVAILABLE',
    statusHistory: [{ from: null, to: 'AVAILABLE', note: 'Created', by: ctx.userId, at: new Date() }],
  });
  await audit(ctx, {
    action: 'RECORD_CREATED',
    module: 'assets',
    recordId: asset._id,
    recordLabel: label(asset),
    newValues: { assetTag, name: asset.name, category: asset.category, serialNumber: asset.serialNumber, purchaseCost: asset.purchaseCost },
  });
  return getAsset(ctx, String(asset._id));
};

export const updateAsset = async (ctx: RequestContext, id: string, input: AssetUpdate) => {
  const asset = await loadAsset(ctx, id);
  await assertRefsInOrg(ctx.organizationId, input, ['locationId']);
  if (input.assetTag && input.assetTag !== asset.assetTag) await assertTagFree(ctx, input.assetTag, asset._id);
  const before = asset.toObject() as unknown as Record<string, unknown>;
  const { purchaseDate, warrantyExpiry, ...fields } = input;
  const changes: Record<string, unknown> = { ...fields };
  if (purchaseDate !== undefined) changes.purchaseDate = toDate(purchaseDate);
  if (warrantyExpiry !== undefined) changes.warrantyExpiry = toDate(warrantyExpiry);
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete changes[k];
  asset.set(changes);
  await asset.save();
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'assets', recordId: asset._id, recordLabel: label(asset), ...diff(before, changes) });
  return getAsset(ctx, id);
};

export const assignAsset = async (ctx: RequestContext, id: string, input: AssignInput) => {
  if (input.expectedReturnDate && input.expectedReturnDate < input.assignedDate) {
    throw badRequest('Expected return date must be on or after the assignment date', 'VALIDATION_ERROR', [
      { path: 'expectedReturnDate', message: 'Must be on or after the assignment date' },
    ]);
  }
  const employee = await EmployeeModel.findOne({
    _id: input.employeeId,
    organizationId: ctx.organizationId,
    deletedAt: null,
    employmentStatus: ACTIVE_EMPLOYEE,
  })
    .select('firstName lastName employeeId userId')
    .lean();
  if (!employee) throw badRequest('Employee not found or not active', 'INVALID_REFERENCE', [{ path: 'employeeId', message: 'Employee not found or not active' }]);

  const { asset, assignment } = await withTransaction(async (session) => {
    const asset = await loadAsset(ctx, id, session);
    const from = asset.status as AssetStatus;
    assertTransition(from, 'ASSIGNED');
    const [assignment] = await AssetAssignmentModel.create(
      [
        {
          organizationId: ctx.organizationId,
          assetId: asset._id,
          employeeId: employee._id,
          assignedDate: dateOnly(input.assignedDate),
          expectedReturnDate: toDate(input.expectedReturnDate),
          conditionAtAssignment: input.condition,
          notes: input.notes,
          status: 'ACTIVE',
          assignedBy: ctx.userId,
        },
      ],
      { session },
    );
    // Conditional update: a concurrent assignment of the same asset loses.
    const res = await AssetModel.updateOne(
      { _id: asset._id, organizationId: ctx.organizationId, status: from },
      {
        $set: { status: 'ASSIGNED', condition: input.condition, currentAssignmentId: assignment!._id, currentEmployeeId: employee._id },
        $push: {
          statusHistory: {
            from,
            to: 'ASSIGNED',
            note: `Assigned to ${employee.firstName} ${employee.lastName} (${employee.employeeId})`,
            by: ctx.userId,
            at: new Date(),
          },
        },
      },
      { session },
    );
    if (!res.modifiedCount) throw conflict('The asset was modified concurrently; please retry', 'CONCURRENT_MODIFICATION');
    return { asset, assignment: assignment! };
  });

  await audit(ctx, {
    action: 'ASSET_ASSIGNED',
    module: 'assets',
    recordId: asset._id,
    recordLabel: label(asset),
    oldValues: { status: asset.status },
    newValues: { status: 'ASSIGNED', employeeId: employee._id, assignmentId: assignment._id, assignedDate: input.assignedDate },
  });
  await notify({
    organizationId: ctx.organizationId,
    userIds: [employee.userId],
    type: 'ASSET',
    title: 'Asset assigned to you',
    message: `${asset.name} (${asset.assetTag}) has been assigned to you`,
    link: `/assets/${String(asset._id)}`,
    entityType: 'Asset',
    entityId: asset._id,
    excludeUserId: ctx.userId,
  });
  return getAsset(ctx, id);
};

export const returnAsset = async (ctx: RequestContext, id: string, input: ReturnInput) => {
  const { asset, assignment, to } = await withTransaction(async (session) => {
    const asset = await loadAsset(ctx, id, session);
    const from = asset.status as AssetStatus;
    if (from !== 'ASSIGNED') throw unprocessable('This asset is not currently assigned', 'ASSET_NOT_ASSIGNED');
    const to: AssetStatus = input.condition === 'DAMAGED' ? 'REPAIR' : 'AVAILABLE';
    assertTransition(from, to);
    const assignment = await AssetAssignmentModel.findOne({
      organizationId: ctx.organizationId,
      assetId: asset._id,
      status: 'ACTIVE',
      ...(asset.currentAssignmentId ? { _id: asset.currentAssignmentId } : {}),
    }).session(session ?? null);
    if (!assignment) throw unprocessable('No active assignment found for this asset', 'ASSET_NOT_ASSIGNED');
    const returned = dateOnly(input.returnedDate);
    if (returned < assignment.assignedDate) {
      throw badRequest('Return date cannot be before the assignment date', 'VALIDATION_ERROR', [
        { path: 'returnedDate', message: 'Cannot be before the assignment date' },
      ]);
    }
    assignment.set({ status: 'RETURNED', returnedDate: returned, conditionAtReturn: input.condition, returnNotes: input.notes, returnedTo: ctx.userId });
    await assignment.save({ session });
    const res = await AssetModel.updateOne(
      { _id: asset._id, organizationId: ctx.organizationId, status: from },
      {
        $set: { status: to, condition: input.condition, currentAssignmentId: null, currentEmployeeId: null },
        $push: { statusHistory: { from, to, note: input.notes ?? `Returned (${input.condition.toLowerCase()})`, by: ctx.userId, at: new Date() } },
      },
      { session },
    );
    if (!res.modifiedCount) throw conflict('The asset was modified concurrently; please retry', 'CONCURRENT_MODIFICATION');
    return { asset, assignment, to };
  });

  await audit(ctx, {
    action: 'ASSET_RETURNED',
    module: 'assets',
    recordId: asset._id,
    recordLabel: label(asset),
    oldValues: { status: 'ASSIGNED', employeeId: assignment.employeeId },
    newValues: { status: to, condition: input.condition, returnedDate: input.returnedDate },
  });
  await notify({
    organizationId: ctx.organizationId,
    userIds: await userIdsForEmployees(ctx.organizationId, [assignment.employeeId]),
    type: 'ASSET',
    title: 'Asset returned',
    message: `Return of ${asset.name} (${asset.assetTag}) has been recorded`,
    link: `/assets/${String(asset._id)}`,
    entityType: 'Asset',
    entityId: asset._id,
    excludeUserId: ctx.userId,
  });
  return getAsset(ctx, id);
};

export const changeAssetStatus = async (ctx: RequestContext, id: string, input: StatusInput) => {
  const asset = await loadAsset(ctx, id);
  const from = asset.status as AssetStatus;
  if (from === 'ASSIGNED') throw unprocessable('Record the return of an assigned asset before changing its status', 'ASSET_ASSIGNED');
  assertTransition(from, input.status);
  const res = await AssetModel.updateOne(
    { _id: asset._id, organizationId: ctx.organizationId, status: from },
    {
      $set: { status: input.status },
      $push: { statusHistory: { from, to: input.status, note: input.notes, by: ctx.userId, at: new Date() } },
    },
  );
  if (!res.modifiedCount) throw conflict('The asset was modified concurrently; please retry', 'CONCURRENT_MODIFICATION');
  await audit(ctx, {
    action: 'ASSET_STATUS_CHANGED',
    module: 'assets',
    recordId: asset._id,
    recordLabel: label(asset),
    oldValues: { status: from },
    newValues: { status: input.status, notes: input.notes },
  });
  return getAsset(ctx, id);
};

export const deleteAsset = async (ctx: RequestContext, id: string) => {
  const asset = await loadAsset(ctx, id);
  if (asset.status !== 'AVAILABLE' && asset.status !== 'RETIRED') {
    throw unprocessable('Only available or retired assets can be deleted', 'ASSET_IN_USE');
  }
  asset.deletedAt = new Date();
  await asset.save();
  await audit(ctx, {
    action: 'RECORD_DELETED',
    module: 'assets',
    recordId: asset._id,
    recordLabel: label(asset),
    oldValues: { assetTag: asset.assetTag, status: asset.status },
  });
};

/** Active assignments for an employee (used by offboarding). */
export const activeAssignmentsFor = (organizationId: Types.ObjectId, employeeId: Types.ObjectId) =>
  AssetAssignmentModel.find({ organizationId, employeeId, status: 'ACTIVE' })
    .populate({ path: 'assetId', select: 'assetTag name category serialNumber status' })
    .sort({ assignedDate: 1 })
    .lean();
