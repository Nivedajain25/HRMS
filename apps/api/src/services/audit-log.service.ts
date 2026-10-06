import { Types, type FilterQuery } from 'mongoose';
import type { AuditAction } from '@stencil/shared';
import { AuditLogModel, EmployeeModel, type AuditLog } from '../models';
import { can, type RequestContext } from '../types/context';
import { addDaysKey, zonedInstant } from '../utils/dates';
import { forbidden, notFound } from '../utils/errors';
import { buildPagination, escapeRegex } from '../utils/pagination';
import { isManagerOf } from './scope.service';

export interface AuditLogQuery {
  page: number;
  limit: number;
  action?: AuditAction;
  module?: string;
  userId?: string;
  recordId?: string;
  from?: string;
  to?: string;
  search?: string;
}

/**
 * Audit trail listing (read-only; there are no update/delete endpoints and the
 * model rejects mutations). Date filters are calendar days in the org timezone.
 */
export const listAuditLogs = async (ctx: RequestContext, q: AuditLogQuery) => {
  const filter: FilterQuery<AuditLog> = { organizationId: ctx.organizationId };
  if (q.action) filter.action = q.action;
  if (q.module) filter.module = q.module;
  if (q.userId) filter.userId = new Types.ObjectId(q.userId);
  if (q.recordId) filter.recordId = new Types.ObjectId(q.recordId);
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = zonedInstant(q.from, '00:00', ctx.timezone);
    if (q.to) range.$lt = zonedInstant(addDaysKey(q.to, 1), '00:00', ctx.timezone);
    filter.timestamp = range;
  }
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ recordLabel: rx }, { userName: rx }];
  }
  const [items, total] = await Promise.all([
    AuditLogModel.find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    AuditLogModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

/**
 * Activity for one record ("Activity" tabs). Requires `audit:read`, except
 * for employee records where the employee themself, `employee:read` holders
 * and their managers may view it.
 */
export const recordActivity = async (ctx: RequestContext, module: string, recordId: string) => {
  const full = can(ctx, 'audit:read');
  if (!full) {
    if (module !== 'employees') throw forbidden();
    const self = ctx.employeeId?.equals(recordId) ?? false;
    const allowed = self || can(ctx, 'employee:read') || (can(ctx, 'team:view') && (await isManagerOf(ctx, recordId)));
    if (!allowed) throw forbidden();
    const exists = await EmployeeModel.exists({ _id: recordId, organizationId: ctx.organizationId });
    if (!exists) throw notFound('Employee');
  }
  const rows = await AuditLogModel.find({ organizationId: ctx.organizationId, module, recordId: new Types.ObjectId(recordId) })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean();
  // Network metadata is only for auditors.
  if (full) return rows;
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    delete out.ipAddress;
    delete out.userAgent;
    return out;
  });
};
