import { Types } from 'mongoose';
import type { PaginationQuery } from '@stencil/shared';
import { DepartmentModel, DesignationModel, EmployeeModel, LocationModel } from '../models';
import type { RequestContext } from '../types/context';
import { badRequest, unprocessable } from '../utils/errors';
import { createCrudService } from './crud.service';
import { assertRefsInOrg } from './refs.service';

const countEmployeesBy = async (ctx: RequestContext, field: 'departmentId' | 'designationId' | 'locationId') => {
  const rows = await EmployeeModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { organizationId: ctx.organizationId, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

const blockIfEmployees = (field: 'departmentId' | 'designationId' | 'locationId', label: string) => async (ctx: RequestContext, id: string) => {
  const n = await EmployeeModel.countDocuments({
    organizationId: ctx.organizationId,
    [field]: id,
    deletedAt: null,
    employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
  });
  if (n) throw unprocessable(`This ${label} has ${n} active employee(s). Reassign them before archiving.`, 'IN_USE');
};

/* ---------------------------- Departments --------------------------- */

const departmentCrud = createCrudService({
  model: DepartmentModel,
  entity: 'Department',
  module: 'departments',
  searchFields: ['name', 'code'],
  sortFields: ['name', 'code', 'createdAt'],
  populate: [
    { path: 'headId', select: 'employeeId firstName lastName profilePhoto' },
    { path: 'parentId', select: 'name code' },
  ],
  prepare: async (ctx, input, existingId) => {
    await assertRefsInOrg(ctx.organizationId, input, ['headId', 'parentId']);
    if (existingId && input.parentId) {
      // Prevent cycles: the new parent must not be this department or one of its descendants.
      let cursor: string | null = String(input.parentId);
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === existingId) throw badRequest('A department cannot be its own ancestor', 'HIERARCHY_CYCLE');
        const parent: { parentId?: Types.ObjectId | null } | null = await DepartmentModel.findById(cursor).select('parentId').lean();
        cursor = parent?.parentId ? String(parent.parentId) : null;
      }
    }
    return input;
  },
  beforeDelete: async (ctx, id) => {
    await blockIfEmployees('departmentId', 'department')(ctx, id);
    const children = await DepartmentModel.countDocuments({ organizationId: ctx.organizationId, parentId: id, deletedAt: null });
    if (children) throw unprocessable('Archive or move sub-departments first', 'HAS_CHILDREN');
  },
});

export const departments = {
  ...departmentCrud,
  list: async (ctx: RequestContext, q: PaginationQuery & { status?: string }) => {
    const result = await departmentCrud.list(ctx, q, q.status ? { status: q.status } : {});
    const counts = await countEmployeesBy(ctx, 'departmentId');
    return { ...result, items: result.items.map((d) => ({ ...d, employeeCount: counts.get(String(d._id)) ?? 0 })) };
  },
  /** Department tree with employee counts. */
  tree: async (ctx: RequestContext) => {
    const [all, counts] = await Promise.all([departmentCrud.all(ctx), countEmployeesBy(ctx, 'departmentId')]);
    type Node = (typeof all)[number] & { employeeCount: number; children: Node[] };
    const nodes = new Map<string, Node>(all.map((d) => [String(d._id), { ...d, employeeCount: counts.get(String(d._id)) ?? 0, children: [] }]));
    const roots: Node[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(String(node.parentId)) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  },
};

/* --------------------------- Designations --------------------------- */

const designationCrud = createCrudService({
  model: DesignationModel,
  entity: 'Designation',
  module: 'designations',
  searchFields: ['name', 'code'],
  sortFields: ['name', 'code', 'level', 'createdAt'],
  defaultSort: { level: 1, name: 1 },
  populate: [{ path: 'departmentId', select: 'name code' }],
  prepare: async (ctx, input) => {
    await assertRefsInOrg(ctx.organizationId, input, ['departmentId']);
    return input;
  },
  beforeDelete: blockIfEmployees('designationId', 'designation'),
});

export const designations = {
  ...designationCrud,
  list: async (ctx: RequestContext, q: PaginationQuery & { departmentId?: string }) => {
    const extra = q.departmentId && Types.ObjectId.isValid(q.departmentId) ? { departmentId: new Types.ObjectId(q.departmentId) } : {};
    const result = await designationCrud.list(ctx, q, extra);
    const counts = await countEmployeesBy(ctx, 'designationId');
    return { ...result, items: result.items.map((d) => ({ ...d, employeeCount: counts.get(String(d._id)) ?? 0 })) };
  },
};

/* ----------------------------- Locations ---------------------------- */

const locationCrud = createCrudService({
  model: LocationModel,
  entity: 'Location',
  module: 'locations',
  searchFields: ['name', 'city', 'country'],
  sortFields: ['name', 'city', 'type', 'createdAt'],
  beforeDelete: blockIfEmployees('locationId', 'location'),
});

export const locations = {
  ...locationCrud,
  list: async (ctx: RequestContext, q: PaginationQuery & { type?: string }) => {
    const result = await locationCrud.list(ctx, q, q.type ? { type: q.type } : {});
    const counts = await countEmployeesBy(ctx, 'locationId');
    return { ...result, items: result.items.map((d) => ({ ...d, employeeCount: counts.get(String(d._id)) ?? 0 })) };
  },
};
