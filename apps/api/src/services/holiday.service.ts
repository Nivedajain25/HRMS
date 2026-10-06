import { Types, type FilterQuery } from 'mongoose';
import { holidaySchema, holidayUpdateSchema } from '@stencil/shared';
import type { z } from 'zod';
import { EmployeeModel, HolidayModel, LocationModel, type Holiday } from '../models';
import type { RequestContext } from '../types/context';
import { addDaysKey, dateOnly, toDateKey, todayKey, weekdayOf } from '../utils/dates';
import { conflict, notFound } from '../utils/errors';
import { escapeRegex } from '../utils/pagination';
import { audit, diff } from './audit.service';
import { createCrudService } from './crud.service';
import { assertIdsInOrg } from './refs.service';

const crud = createCrudService({
  model: HolidayModel,
  entity: 'Holiday',
  module: 'holidays',
  searchFields: ['name'],
  sortFields: ['date', 'name'],
  defaultSort: { date: 1 },
  populate: [{ path: 'locationIds', select: 'name city' }],
  label: (d) => `${String(d.name)} (${d.date instanceof Date ? toDateKey(d.date) : String(d.date)})`,
});

export interface HolidayOccurrence {
  _id: Types.ObjectId;
  name: string;
  date: string;
  weekday: string;
  type: string;
  description?: string | null;
  recurring: boolean;
  originalDate: string;
  locationIds: unknown[];
}

const isValidKey = (key: string) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && toDateKey(d) === key;
};

/**
 * Holiday occurrences in [from, to]. Recurring holidays are expanded onto
 * every year in range (from their original year onwards). With a location,
 * only organization-wide holidays and those scoped to that location are returned.
 */
export const expandHolidays = async (
  organizationId: Types.ObjectId,
  from: string,
  to: string,
  opts: { locationId?: Types.ObjectId | string | null; type?: string } = {},
): Promise<HolidayOccurrence[]> => {
  const base: FilterQuery<Holiday> = { organizationId, deletedAt: null };
  if (opts.type) base.type = opts.type;
  if (opts.locationId) base.$or = [{ locationIds: { $size: 0 } }, { locationIds: new Types.ObjectId(String(opts.locationId)) }];
  const [fixed, recurring] = await Promise.all([
    HolidayModel.find({ ...base, recurring: false, date: { $gte: dateOnly(from), $lte: dateOnly(to) } })
      .populate({ path: 'locationIds', select: 'name city' })
      .lean(),
    HolidayModel.find({ ...base, recurring: true, date: { $lte: dateOnly(to) } })
      .populate({ path: 'locationIds', select: 'name city' })
      .lean(),
  ]);
  const out: HolidayOccurrence[] = [];
  const push = (h: (typeof fixed)[number], key: string) =>
    out.push({
      _id: h._id,
      name: h.name,
      date: key,
      weekday: weekdayOf(key),
      type: h.type,
      description: h.description ?? null,
      recurring: h.recurring,
      originalDate: toDateKey(h.date),
      locationIds: h.locationIds,
    });
  for (const h of fixed) push(h, toDateKey(h.date));
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  for (const h of recurring) {
    const original = toDateKey(h.date);
    const md = original.slice(5);
    for (let y = Math.max(startYear, Number(original.slice(0, 4))); y <= endYear; y++) {
      const key = `${y}-${md}`;
      if (key >= from && key <= to && isValidKey(key)) push(h, key);
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
};

export const listHolidays = async (ctx: RequestContext, q: { year?: number; locationId?: string; type?: string }) => {
  const year = q.year ?? Number(todayKey(ctx.timezone).slice(0, 4));
  return expandHolidays(ctx.organizationId, `${year}-01-01`, `${year}-12-31`, { locationId: q.locationId, type: q.type });
};

export const upcomingHolidays = async (ctx: RequestContext, q: { limit?: number }) => {
  const employee = ctx.employeeId
    ? await EmployeeModel.findOne({ _id: ctx.employeeId, organizationId: ctx.organizationId }).select('locationId').lean()
    : null;
  const today = todayKey(ctx.timezone);
  const all = await expandHolidays(ctx.organizationId, today, addDaysKey(today, 366), { locationId: employee?.locationId ?? null });
  // Without a location, employees only see organization-wide holidays.
  const visible = employee?.locationId ? all : all.filter((h) => !h.locationIds.length);
  return visible.slice(0, q.limit ?? 5);
};

export const getHoliday = (ctx: RequestContext, id: string) => crud.get(ctx, id);

const assertNoDuplicate = async (ctx: RequestContext, name: string, date: string, exceptId?: string) => {
  const exists = await HolidayModel.exists({
    organizationId: ctx.organizationId,
    deletedAt: null,
    date: dateOnly(date),
    name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i'),
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  });
  if (exists) throw conflict('A holiday with this name already exists on that date', 'HOLIDAY_EXISTS');
};

type HolidayCreate = z.output<typeof holidaySchema>;
type HolidayUpdate = z.output<typeof holidayUpdateSchema>;

export const createHoliday = async (ctx: RequestContext, input: HolidayCreate) => {
  await assertIdsInOrg(ctx.organizationId, LocationModel as never, input.locationIds, 'locations');
  await assertNoDuplicate(ctx, input.name, input.date);
  const doc = await HolidayModel.create({ ...input, date: dateOnly(input.date), organizationId: ctx.organizationId });
  await audit(ctx, { action: 'RECORD_CREATED', module: 'holidays', recordId: doc._id, recordLabel: `${doc.name} (${input.date})`, newValues: input });
  return crud.get(ctx, String(doc._id));
};

export const updateHoliday = async (ctx: RequestContext, id: string, input: HolidayUpdate) => {
  const doc = await HolidayModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!doc) throw notFound('Holiday');
  if (input.locationIds) await assertIdsInOrg(ctx.organizationId, LocationModel as never, input.locationIds, 'locations');
  const name = input.name ?? doc.name;
  const date = input.date ?? toDateKey(doc.date);
  if (input.name !== undefined || input.date !== undefined) await assertNoDuplicate(ctx, name, date, id);
  const before = { ...(doc.toObject() as unknown as Record<string, unknown>), date: toDateKey(doc.date) };
  const { date: newDate, ...rest } = input;
  doc.set(rest);
  if (newDate) doc.date = dateOnly(newDate);
  await doc.save();
  await audit(ctx, { action: 'RECORD_UPDATED', module: 'holidays', recordId: doc._id, recordLabel: `${doc.name} (${date})`, ...diff(before, input as Record<string, unknown>) });
  return crud.get(ctx, id);
};

export const removeHoliday = (ctx: RequestContext, id: string) => crud.remove(ctx, id);
