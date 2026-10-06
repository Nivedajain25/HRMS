import type { FilterQuery } from 'mongoose';
import type { SearchResult } from '@stencil/types';
import {
  AnnouncementModel,
  AssetModel,
  CandidateModel,
  DepartmentModel,
  DesignationModel,
  DocumentModel,
  EmployeeModel,
  LeaveRequestModel,
  LeaveTypeModel,
  type Asset,
  type DocumentRecord,
  type LeaveRequest,
} from '../models';
import { can, type RequestContext } from '../types/context';
import { toDateKey } from '../utils/dates';
import { badRequest } from '../utils/errors';
import { escapeRegex } from '../utils/pagination';
import { visibleFilter } from './announcement.service';
import { resolveEmployeeScope } from './scope.service';

export type SearchType = SearchResult['type'];
export const SEARCH_TYPES: SearchType[] = ['employee', 'candidate', 'department', 'designation', 'asset', 'document', 'leave', 'announcement'];

export interface SearchQuery {
  q: string;
  types?: string;
  limit?: number;
}

type Named = { name?: string | null } | null | undefined;
const nameOf = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? ((v as Named)?.name ?? undefined) : undefined);
const personName = (p: unknown) => {
  const e = p as { firstName?: string; lastName?: string } | null;
  return e ? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() : '';
};
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined;

/** Name conditions: any field contains the term, or "first last" prefix matches. */
const personFilter = (term: string, fields: string[]) => {
  const rx = new RegExp(escapeRegex(term), 'i');
  const or: Record<string, unknown>[] = fields.map((f) => ({ [f]: rx }));
  const parts = term.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    or.push({
      firstName: new RegExp(`^${escapeRegex(parts[0]!)}`, 'i'),
      lastName: new RegExp(`^${escapeRegex(parts.slice(1).join(' '))}`, 'i'),
    });
  }
  return { $or: or };
};

/**
 * Global search across modules. Every group applies the same visibility
 * rules as the module's own list endpoint:
 *  - employees: basic directory hits (name/code/designation) for everyone
 *  - candidates: recruitment:read only
 *  - assets / documents / leave: org-wide with the module read permission,
 *    otherwise the user's own records (confidential documents never leak)
 *  - announcements: only those visible to the user
 */
export const globalSearch = async (ctx: RequestContext, query: SearchQuery): Promise<SearchResult[]> => {
  const term = query.q.trim();
  if (term.length < 2) throw badRequest('Enter at least 2 characters', 'QUERY_TOO_SHORT');
  const limit = Math.min(Math.max(query.limit ?? 5, 1), 20);
  const requested = query.types
    ? SEARCH_TYPES.filter((t) => query.types!.split(',').map((s) => s.trim()).includes(t))
    : SEARCH_TYPES;
  const want = new Set(requested);
  const rx = new RegExp(escapeRegex(term), 'i');
  const org = ctx.organizationId;

  const tasks: Record<SearchType, () => Promise<SearchResult[]>> = {
    employee: async () => {
      const rows = await EmployeeModel.find({
        organizationId: org,
        deletedAt: null,
        employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] },
        ...personFilter(term, ['firstName', 'lastName', 'employeeId', 'workEmail']),
      })
        .select('employeeId firstName lastName designationId departmentId')
        .populate([{ path: 'designationId', select: 'name' }, { path: 'departmentId', select: 'name' }])
        .sort({ firstName: 1, lastName: 1 })
        .limit(limit)
        .lean();
      return rows.map((e) => ({
        type: 'employee' as const,
        id: String(e._id),
        title: `${e.firstName} ${e.lastName}`,
        subtitle: join(e.employeeId, nameOf(e.designationId), nameOf(e.departmentId)),
        url: `/employees/${e._id}`,
      }));
    },
    candidate: async () => {
      if (!can(ctx, 'recruitment:read')) return [];
      const rows = await CandidateModel.find({ organizationId: org, deletedAt: null, ...personFilter(term, ['firstName', 'lastName', 'email']) })
        .select('firstName lastName email stage jobId')
        .populate({ path: 'jobId', select: 'title' })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      return rows.map((c) => ({
        type: 'candidate' as const,
        id: String(c._id),
        title: `${c.firstName} ${c.lastName}`,
        subtitle: join((c.jobId as unknown as { title?: string } | null)?.title, c.stage),
        url: `/recruitment/candidates/${c._id}`,
      }));
    },
    department: async () => {
      const rows = await DepartmentModel.find({ organizationId: org, deletedAt: null, $or: [{ name: rx }, { code: rx }] })
        .select('name code')
        .sort({ name: 1 })
        .limit(limit)
        .lean();
      return rows.map((d) => ({ type: 'department' as const, id: String(d._id), title: d.name, subtitle: d.code, url: '/departments' }));
    },
    designation: async () => {
      const rows = await DesignationModel.find({ organizationId: org, deletedAt: null, $or: [{ name: rx }, { code: rx }] })
        .select('name code level')
        .sort({ name: 1 })
        .limit(limit)
        .lean();
      return rows.map((d) => ({
        type: 'designation' as const,
        id: String(d._id),
        title: d.name,
        subtitle: join(d.code, `Level ${d.level}`),
        url: '/designations',
      }));
    },
    asset: async () => {
      const filter: FilterQuery<Asset> = { organizationId: org, deletedAt: null, $or: [{ name: rx }, { assetTag: rx }, { serialNumber: rx }] };
      if (!can(ctx, 'asset:read')) {
        if (!ctx.employeeId) return [];
        filter.currentEmployeeId = ctx.employeeId;
      }
      const rows = await AssetModel.find(filter).select('name assetTag category status').sort({ assetTag: 1 }).limit(limit).lean();
      return rows.map((a) => ({
        type: 'asset' as const,
        id: String(a._id),
        title: `${a.name} (${a.assetTag})`,
        subtitle: join(a.category, a.status),
        url: `/assets/${a._id}`,
      }));
    },
    document: async () => {
      const base: FilterQuery<DocumentRecord> = {
        organizationId: org,
        deletedAt: null,
        isLatest: true,
        context: { $in: ['EMPLOYEE', 'ORGANIZATION'] },
        $and: [{ $or: [{ title: rx }, { originalName: rx }] }],
      };
      if (!can(ctx, 'document:read')) {
        const own: Record<string, unknown>[] = [{ employeeId: null, context: 'ORGANIZATION' }];
        if (ctx.employeeId) own.push({ employeeId: ctx.employeeId });
        base.confidential = false;
        (base.$and as Record<string, unknown>[]).push({ $or: own });
      }
      const rows = await DocumentModel.find(base).select('title category employeeId').sort({ createdAt: -1 }).limit(limit).lean();
      return rows.map((d) => ({ type: 'document' as const, id: String(d._id), title: d.title, subtitle: d.category, url: `/documents?highlight=${d._id}` }));
    },
    leave: async () => {
      const scope = await resolveEmployeeScope(ctx, 'leave:read');
      const empFilter: Record<string, unknown> = { organizationId: org, ...personFilter(term, ['firstName', 'lastName', 'employeeId']) };
      if (scope.employeeIds) empFilter._id = { $in: scope.employeeIds };
      const [emps, types] = await Promise.all([
        EmployeeModel.find(empFilter).select('_id').limit(200).lean(),
        LeaveTypeModel.find({ organizationId: org, $or: [{ name: rx }, { code: rx }] }).select('_id').lean(),
      ]);
      const or: Record<string, unknown>[] = [];
      if (emps.length) or.push({ employeeId: { $in: emps.map((e) => e._id) } });
      if (types.length) or.push({ leaveTypeId: { $in: types.map((t) => t._id) } });
      if (!or.length) return [];
      const filter: FilterQuery<LeaveRequest> = { organizationId: org, $or: or };
      if (scope.employeeIds) filter.employeeId = { $in: scope.employeeIds };
      const rows = await LeaveRequestModel.find(filter)
        .select('employeeId leaveTypeId startDate endDate status days')
        .populate([{ path: 'employeeId', select: 'firstName lastName' }, { path: 'leaveTypeId', select: 'name' }])
        .sort({ startDate: -1 })
        .limit(limit)
        .lean();
      return rows.map((l) => ({
        type: 'leave' as const,
        id: String(l._id),
        title: join(personName(l.employeeId), nameOf(l.leaveTypeId)) ?? 'Leave request',
        subtitle: `${toDateKey(l.startDate)} → ${toDateKey(l.endDate)} · ${l.status}`,
        url: `/leave/requests/${l._id}`,
      }));
    },
    announcement: async () => {
      const filter = can(ctx, 'announcement:manage') ? { organizationId: org, deletedAt: null } : await visibleFilter(ctx);
      const rows = await AnnouncementModel.find({ ...filter, title: rx }).select('title priority publishAt').sort({ publishAt: -1 }).limit(limit).lean();
      return rows.map((a) => ({
        type: 'announcement' as const,
        id: String(a._id),
        title: a.title,
        subtitle: a.publishAt ? toDateKey(a.publishAt) : undefined,
        url: `/announcements/${a._id}`,
      }));
    },
  };

  const groups = await Promise.all(SEARCH_TYPES.filter((t) => want.has(t)).map((t) => tasks[t]()));
  return groups.flat();
};
