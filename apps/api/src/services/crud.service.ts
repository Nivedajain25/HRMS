import type { FilterQuery, Model, PopulateOptions } from 'mongoose';
import type { PaginationQuery } from '@stencil/shared';
import type { RequestContext } from '../types/context';
import { notFound } from '../utils/errors';
import { buildSort, paginate, searchFilter } from '../utils/pagination';
import { audit, diff } from './audit.service';

interface CrudOptions<T> {
  model: Model<T>;
  /** Human label used in errors, e.g. "Department". */
  entity: string;
  /** Audit module key. */
  module: string;
  searchFields: string[];
  sortFields: string[];
  defaultSort?: Record<string, 1 | -1>;
  populate?: (string | PopulateOptions)[];
  /** Soft-delete via `deletedAt` (default) or hard delete. */
  softDelete?: boolean;
  /** Validates/normalizes input before create/update (e.g. reference checks). */
  prepare?: (ctx: RequestContext, input: Record<string, unknown>, existingId?: string) => Promise<Record<string, unknown>>;
  /** Throws if a record cannot be deleted (e.g. still referenced). */
  beforeDelete?: (ctx: RequestContext, id: string) => Promise<void>;
  label?: (doc: Record<string, unknown>) => string;
}

/**
 * Tenant-scoped CRUD for master data. Every query is constrained by the
 * caller's organizationId; ids from the client can never reach another tenant.
 */
export const createCrudService = <T>(opts: CrudOptions<T>) => {
  const soft = opts.softDelete ?? true;
  const base = (ctx: RequestContext) =>
    ({ organizationId: ctx.organizationId, ...(soft ? { deletedAt: null } : {}) }) as FilterQuery<T>;
  const label = (doc: Record<string, unknown>) => opts.label?.(doc) ?? String(doc.name ?? doc.title ?? doc._id);

  const list = async (ctx: RequestContext, q: PaginationQuery, extra: FilterQuery<T> = {}) =>
    paginate(opts.model, {
      filter: { ...base(ctx), ...searchFilter(q.search, opts.searchFields), ...extra } as FilterQuery<T>,
      page: q.page,
      limit: q.limit,
      sort: buildSort(q, opts.sortFields, opts.defaultSort ?? { name: 1 }),
      populate: opts.populate,
    });

  const all = async (ctx: RequestContext, extra: FilterQuery<T> = {}) =>
    opts.model
      .find({ ...base(ctx), ...extra } as FilterQuery<T>)
      .sort(opts.defaultSort ?? { name: 1 })
      .limit(1000)
      .lean();

  const get = async (ctx: RequestContext, id: string) => {
    let query = opts.model.findOne({ ...base(ctx), _id: id } as FilterQuery<T>);
    for (const p of opts.populate ?? []) query = query.populate(p as PopulateOptions);
    const doc = await query.lean();
    if (!doc) throw notFound(opts.entity);
    return doc;
  };

  const create = async (ctx: RequestContext, input: Record<string, unknown>) => {
    const data = opts.prepare ? await opts.prepare(ctx, input) : input;
    const doc = await opts.model.create({ ...data, organizationId: ctx.organizationId });
    const json = doc.toJSON() as Record<string, unknown>;
    await audit(ctx, { action: 'RECORD_CREATED', module: opts.module, recordId: doc._id as never, recordLabel: label(json), newValues: data });
    return json;
  };

  const update = async (ctx: RequestContext, id: string, input: Record<string, unknown>) => {
    const doc = await opts.model.findOne({ ...base(ctx), _id: id } as FilterQuery<T>);
    if (!doc) throw notFound(opts.entity);
    const data = opts.prepare ? await opts.prepare(ctx, input, id) : input;
    const before = doc.toObject() as Record<string, unknown>;
    doc.set(data);
    await doc.save();
    const json = doc.toJSON() as Record<string, unknown>;
    await audit(ctx, { action: 'RECORD_UPDATED', module: opts.module, recordId: doc._id as never, recordLabel: label(json), ...diff(before, data) });
    return json;
  };

  const remove = async (ctx: RequestContext, id: string) => {
    const doc = await opts.model.findOne({ ...base(ctx), _id: id } as FilterQuery<T>);
    if (!doc) throw notFound(opts.entity);
    await opts.beforeDelete?.(ctx, id);
    if (soft) {
      doc.set({ deletedAt: new Date(), ...('status' in (doc.toObject() as object) ? { status: 'ARCHIVED' } : {}) });
      await doc.save();
    } else {
      await doc.deleteOne();
    }
    await audit(ctx, { action: 'RECORD_DELETED', module: opts.module, recordId: doc._id as never, recordLabel: label(doc.toObject() as Record<string, unknown>) });
  };

  return { list, all, get, create, update, remove, base };
};
