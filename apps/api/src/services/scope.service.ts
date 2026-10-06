import { Types, type FilterQuery } from 'mongoose';
import type { Permission } from '@stencil/shared';
import { EmployeeModel } from '../models';
import { can, type RequestContext } from '../types/context';
import { forbidden } from '../utils/errors';

/** All direct and indirect reports of an employee (via $graphLookup). */
export const getReportIds = async (organizationId: Types.ObjectId, managerId: Types.ObjectId): Promise<Types.ObjectId[]> => {
  const result = await EmployeeModel.aggregate<{ reports: { _id: Types.ObjectId }[] }>([
    { $match: { _id: managerId, organizationId } },
    {
      $graphLookup: {
        from: 'employees',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'managerId',
        as: 'reports',
        maxDepth: 10,
        restrictSearchWithMatch: { organizationId, deletedAt: null },
      },
    },
    { $project: { 'reports._id': 1 } },
  ]);
  return result[0]?.reports.map((r) => r._id) ?? [];
};

export const getDirectReportIds = async (organizationId: Types.ObjectId, managerId: Types.ObjectId) => {
  const rows = await EmployeeModel.find({ organizationId, managerId, deletedAt: null }).select('_id').lean();
  return rows.map((r) => r._id);
};

export const isManagerOf = async (ctx: RequestContext, employeeId: Types.ObjectId | string) => {
  if (!ctx.employeeId) return false;
  const reports = await getReportIds(ctx.organizationId, ctx.employeeId);
  return reports.some((id) => id.equals(employeeId));
};

export type AccessScope = 'all' | 'team' | 'self';

/**
 * Resolves what employee records a user may see for a module:
 *  - `<module>:read` → all employees in the organization
 *  - `team:view`     → self + direct/indirect reports
 *  - otherwise       → self only
 */
export const resolveEmployeeScope = async (
  ctx: RequestContext,
  readAllPermission: Permission,
  requested?: 'me' | 'team' | 'all' | string,
): Promise<{ scope: AccessScope; employeeIds: Types.ObjectId[] | null }> => {
  const self = ctx.employeeId ? [ctx.employeeId] : [];
  if (requested === 'me') return { scope: 'self', employeeIds: self };

  if (can(ctx, readAllPermission) && requested !== 'team') return { scope: 'all', employeeIds: null };

  if ((can(ctx, 'team:view') || can(ctx, readAllPermission)) && ctx.employeeId) {
    const reports = await getReportIds(ctx.organizationId, ctx.employeeId);
    if (requested === 'team') return { scope: 'team', employeeIds: reports };
    return { scope: 'team', employeeIds: [...self, ...reports] };
  }
  if (requested === 'all' || requested === 'team') throw forbidden();
  return { scope: 'self', employeeIds: self };
};

/** Adds an employee restriction to a filter based on a resolved scope. */
export const applyScope = <T>(
  filter: FilterQuery<T>,
  scope: { employeeIds: Types.ObjectId[] | null },
  field = 'employeeId',
): FilterQuery<T> => {
  if (scope.employeeIds === null) return filter;
  return { ...filter, [field]: { $in: scope.employeeIds } } as FilterQuery<T>;
};

/**
 * Asserts the user may access a specific employee's record for a module
 * (IDOR protection for `/:id` endpoints).
 */
export const assertEmployeeAccess = async (
  ctx: RequestContext,
  employeeId: Types.ObjectId | string,
  readAllPermission: Permission,
) => {
  if (ctx.employeeId?.equals(employeeId)) return 'self' as const;
  if (can(ctx, readAllPermission)) return 'all' as const;
  if (can(ctx, 'team:view') && (await isManagerOf(ctx, employeeId))) return 'team' as const;
  throw forbidden('You do not have access to this record');
};

export const toObjectId = (id: string | Types.ObjectId) => (typeof id === 'string' ? new Types.ObjectId(id) : id);
