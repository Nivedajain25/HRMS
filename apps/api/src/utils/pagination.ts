import type { FilterQuery, Model, PopulateOptions, SortOrder } from 'mongoose';
import type { Pagination } from '@stencil/types';
import type { PaginationQuery } from '@stencil/shared';

export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive "contains" regex across several fields. */
export const searchFilter = (search: string | undefined, fields: string[]) => {
  if (!search) return {};
  const regex = new RegExp(escapeRegex(search), 'i');
  return { $or: fields.map((f) => ({ [f]: regex })) };
};

export const buildSort = (
  query: Pick<PaginationQuery, 'sortBy' | 'sortOrder'>,
  allowed: string[],
  fallback: Record<string, SortOrder> = { createdAt: -1 },
): Record<string, SortOrder> => {
  if (query.sortBy && allowed.includes(query.sortBy)) {
    return { [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1, _id: 1 };
  }
  return fallback;
};

export const buildPagination = (page: number, limit: number, total: number): Pagination => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

export interface PaginateOptions<T> {
  filter: FilterQuery<T>;
  page: number;
  limit: number;
  sort: Record<string, SortOrder>;
  populate?: (string | PopulateOptions)[];
  select?: string;
}

export const paginate = async <T>(model: Model<T>, opts: PaginateOptions<T>) => {
  let query = model
    .find(opts.filter)
    .sort(opts.sort)
    .skip((opts.page - 1) * opts.limit)
    .limit(opts.limit);
  if (opts.select) query = query.select(opts.select);
  for (const p of opts.populate ?? []) query = query.populate(p as PopulateOptions);
  const [items, total] = await Promise.all([query.lean(), model.countDocuments(opts.filter)]);
  return { items, pagination: buildPagination(opts.page, opts.limit, total) };
};
