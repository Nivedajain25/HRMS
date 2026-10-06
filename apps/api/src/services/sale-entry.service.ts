import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { ArchitectMeetingModel, EmployeeModel, SaleEntryModel, SalesTargetModel, type SaleEntry } from '../models';
import { can, type RequestContext } from '../types/context';
import { todayKey } from '../utils/dates';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { buildPagination } from '../utils/pagination';

/** Seeing everyone's sales: the same people who see the company sales figures. */
const canSeeAll = (ctx: RequestContext) => can(ctx, 'report:read') || can(ctx, 'employee:read');

const EMPLOYEE_POPULATE = {
  path: 'employeeId',
  select: 'employeeId firstName lastName profilePhoto departmentId',
  populate: { path: 'departmentId', select: 'name' },
};

/** HR / admin set monthly targets. */
const canSetTargets = (ctx: RequestContext) => can(ctx, 'employee:update');

const rx = (s: string) => ({ $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' });

/** The filter for a list / summary: mine, or (scope=all, allowed) everyone's or one employee's. */
const scopeFilter = (
  ctx: RequestContext,
  q: { scope?: 'me' | 'all'; employeeId?: string; from?: string; to?: string; search?: string },
  searchFields: string[] = ['customer', 'note'],
) => {
  const filter: FilterQuery<SaleEntry> = { organizationId: ctx.organizationId, deletedAt: null };
  if (q.scope === 'all') {
    if (!canSeeAll(ctx)) throw forbidden();
    if (q.employeeId) filter.employeeId = new Types.ObjectId(q.employeeId);
  } else {
    if (!ctx.employeeId) throw badRequest('Only employees have their own sales', 'NOT_AN_EMPLOYEE');
    filter.employeeId = ctx.employeeId;
  }
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.search) filter.$or = searchFields.map((f) => ({ [f]: rx(q.search!) }));
  return filter;
};

export const listSales = async (
  ctx: RequestContext,
  q: { scope?: 'me' | 'all'; employeeId?: string; from?: string; to?: string; search?: string; page: number; limit: number },
) => {
  const filter = scopeFilter(ctx, q);
  const [items, total] = await Promise.all([
    SaleEntryModel.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(EMPLOYEE_POPULATE)
      .lean(),
    SaleEntryModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

/**
 * Totals for the period (from / to), a monthly series for the last N months (ending this month), and — for
 * scope=all — each employee's total in the period (leaderboard).
 */
export const salesSummary = async (ctx: RequestContext, q: { scope?: 'me' | 'all'; employeeId?: string; from?: string; to?: string; months?: number }) => {
  const filter = scopeFilter(ctx, q);
  const months = q.months ?? 12;
  const today = todayKey(ctx.timezone);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const startIdx = y * 12 + (m - 1) - (months - 1);
  const firstMonth = `${Math.floor(startIdx / 12)}-${String((startIdx % 12) + 1).padStart(2, '0')}`;
  const seriesFilter: FilterQuery<SaleEntry> = { ...filter, date: { $gte: `${firstMonth}-01`, $lte: today } };

  const byMonthPipe: PipelineStage[] = [{ $match: seriesFilter }, { $group: { _id: { $substrBytes: ['$date', 0, 7] }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }];
  const months_ = Array.from({ length: months }, (_, i) => {
    const idx = startIdx + i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  });
  // Targets and architect meetings for the same people (search doesn't apply to them).
  const who: FilterQuery<SaleEntry> = { organizationId: ctx.organizationId };
  if (filter.employeeId) who.employeeId = filter.employeeId;
  const [targets, archByMonth, archTotal] = await Promise.all([
    SalesTargetModel.aggregate<{ _id: string; amount: number }>([{ $match: { ...who, month: { $in: months_ } } }, { $group: { _id: '$month', amount: { $sum: '$amount' } } }]),
    ArchitectMeetingModel.aggregate<{ _id: string; n: number }>([
      { $match: { ...who, deletedAt: null, date: { $gte: `${firstMonth}-01`, $lte: today } } },
      { $group: { _id: { $substrBytes: ['$date', 0, 7] }, n: { $sum: 1 } } },
    ]),
    ArchitectMeetingModel.countDocuments({ ...who, deletedAt: null, ...(filter.date ? { date: filter.date } : {}) }),
  ]);
  const targetMap = new Map(targets.map((t) => [t._id, t.amount]));
  const archMap = new Map(archByMonth.map((a) => [a._id, a.n]));
  const [totals, byMonth, byEmployee] = await Promise.all([
    SaleEntryModel.aggregate<{ amount: number; count: number; customers: string[] }>([
      { $match: filter },
      { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 }, customers: { $addToSet: { $toLower: '$customer' } } } },
    ]),
    SaleEntryModel.aggregate<{ _id: string; amount: number; count: number }>(byMonthPipe),
    q.scope === 'all'
      ? SaleEntryModel.aggregate<{ _id: Types.ObjectId; amount: number; count: number; last: string }>([
          { $match: filter },
          { $group: { _id: '$employeeId', amount: { $sum: '$amount' }, count: { $sum: 1 }, last: { $max: '$date' } } },
          { $sort: { amount: -1 } },
          { $limit: 100 },
        ])
      : Promise.resolve([]),
  ]);

  const monthMap = new Map(byMonth.map((r) => [r._id, r]));
  const series = months_.map((key) => {
    const r = monthMap.get(key);
    return { month: key, amount: r?.amount ?? 0, count: r?.count ?? 0, target: targetMap.get(key) ?? null, architects: archMap.get(key) ?? 0 };
  });

  let leaderboard: { employee: unknown; amount: number; count: number; last: string }[] = [];
  if (byEmployee.length) {
    const people = await EmployeeModel.find({ organizationId: ctx.organizationId, _id: { $in: byEmployee.map((r) => r._id) } })
      .select('employeeId firstName lastName profilePhoto departmentId')
      .populate({ path: 'departmentId', select: 'name' })
      .lean();
    const byId = new Map(people.map((p) => [String(p._id), p]));
    leaderboard = byEmployee.map((r) => ({ employee: byId.get(String(r._id)) ?? null, amount: r.amount, count: r.count, last: r.last }));
  }

  const t = totals[0];
  return { total: t?.amount ?? 0, count: t?.count ?? 0, customers: t?.customers.length ?? 0, architects: archTotal, months: series, leaderboard };
};

/* ------------------------------ Targets ------------------------------ */

/**
 * The month's target board (HR / admin): every current employee with their target, achieved sales and
 * architects met that month.
 */
export const targetBoard = async (ctx: RequestContext, q: { month: string }) => {
  if (!canSeeAll(ctx)) throw forbidden();
  const org = ctx.organizationId;
  const range = { $gte: `${q.month}-01`, $lte: `${q.month}-31` };
  const [people, targets, sales, meets] = await Promise.all([
    EmployeeModel.find({ organizationId: org, deletedAt: null, employmentStatus: { $nin: ['EXITED', 'ARCHIVED'] } })
      .select('employeeId firstName lastName profilePhoto departmentId designationId')
      .populate({ path: 'departmentId', select: 'name' })
      .populate({ path: 'designationId', select: 'name' })
      .sort({ firstName: 1 })
      .lean(),
    SalesTargetModel.find({ organizationId: org, month: q.month }).lean(),
    SaleEntryModel.aggregate<{ _id: Types.ObjectId; amount: number; count: number }>([
      { $match: { organizationId: org, deletedAt: null, date: range } },
      { $group: { _id: '$employeeId', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    ArchitectMeetingModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { organizationId: org, deletedAt: null, date: range } }, { $group: { _id: '$employeeId', n: { $sum: 1 } } }]),
  ]);
  const t = new Map(targets.map((x) => [String(x.employeeId), x.amount]));
  const s = new Map(sales.map((x) => [String(x._id), x]));
  const m = new Map(meets.map((x) => [String(x._id), x.n]));
  const rows = people.map((p) => {
    const id = String(p._id);
    const target = t.get(id) ?? null;
    const achieved = s.get(id)?.amount ?? 0;
    return { employee: p, target, achieved, sales: s.get(id)?.count ?? 0, percent: target ? Math.round((achieved / target) * 100) : null, architects: m.get(id) ?? 0 };
  });
  const targetTotal = rows.reduce((a, r) => a + (r.target ?? 0), 0);
  const achievedTotal = rows.reduce((a, r) => a + r.achieved, 0);
  return { month: q.month, rows, targetTotal, achievedTotal, architectsTotal: rows.reduce((a, r) => a + r.architects, 0), canEdit: canSetTargets(ctx) };
};

/** Set (or with 0, clear) an employee's target for a month. */
export const setTarget = async (ctx: RequestContext, input: { employeeId: string; month: string; amount: number }) => {
  if (!canSetTargets(ctx)) throw forbidden();
  const employee = await EmployeeModel.exists({ _id: input.employeeId, organizationId: ctx.organizationId, deletedAt: null });
  if (!employee) throw notFound('Employee');
  const key = { organizationId: ctx.organizationId, employeeId: new Types.ObjectId(input.employeeId), month: input.month };
  if (!input.amount) {
    await SalesTargetModel.deleteOne(key);
    return { ...input, amount: null };
  }
  await SalesTargetModel.updateOne(key, { $set: { amount: input.amount, setBy: ctx.userId } }, { upsert: true });
  return input;
};

/* -------------------------- Architect meetings -------------------------- */

export const listArchitectMeetings = async (
  ctx: RequestContext,
  q: { scope?: 'me' | 'all'; employeeId?: string; from?: string; to?: string; search?: string; page: number; limit: number },
) => {
  const filter = scopeFilter(ctx, q, ['architectName', 'firm', 'projectName', 'location', 'productsDiscussed', 'notes']);
  const [items, total] = await Promise.all([
    ArchitectMeetingModel.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate(EMPLOYEE_POPULATE)
      .lean(),
    ArchitectMeetingModel.countDocuments(filter),
  ]);
  return { items, pagination: buildPagination(q.page, q.limit, total) };
};

type MeetingInput = {
  date: string;
  architectName: string;
  firm?: string;
  phone?: string;
  email?: string;
  meetingType?: string | null;
  projectName?: string;
  location?: string;
  productsDiscussed?: string;
  outcome?: string | null;
  followUpDate?: string | null;
  notes?: string;
};

export const createArchitectMeeting = async (ctx: RequestContext, input: MeetingInput) => {
  if (!ctx.employeeId) throw badRequest('Only employees can log architect meetings', 'NOT_AN_EMPLOYEE');
  if (input.date > todayKey(ctx.timezone)) throw badRequest('The meeting date can’t be in the future', 'FUTURE_DATE');
  const doc = await ArchitectMeetingModel.create({ organizationId: ctx.organizationId, employeeId: ctx.employeeId, createdBy: ctx.userId, ...input });
  return doc.toObject();
};

const findEditableMeeting = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Meeting');
  const doc = await ArchitectMeetingModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!doc) throw notFound('Meeting');
  const mine = ctx.employeeId && String(doc.employeeId) === String(ctx.employeeId);
  if (!mine && !canSeeAll(ctx)) throw forbidden();
  return doc;
};

export const updateArchitectMeeting = async (ctx: RequestContext, id: string, input: Partial<MeetingInput>) => {
  const doc = await findEditableMeeting(ctx, id);
  if (input.date && input.date > todayKey(ctx.timezone)) throw badRequest('The meeting date can’t be in the future', 'FUTURE_DATE');
  Object.assign(doc, input);
  await doc.save();
  return doc.toObject();
};

export const deleteArchitectMeeting = async (ctx: RequestContext, id: string) => {
  const doc = await findEditableMeeting(ctx, id);
  doc.deletedAt = new Date();
  await doc.save();
  return { deleted: true };
};

/** An employee records one of their own sales. */
export const createSale = async (ctx: RequestContext, input: { date: string; customer: string; amount: number; note?: string }) => {
  if (!ctx.employeeId) throw badRequest('Only employees can record sales', 'NOT_AN_EMPLOYEE');
  if (input.date > todayKey(ctx.timezone)) throw badRequest('The sale date can’t be in the future', 'FUTURE_DATE');
  const doc = await SaleEntryModel.create({ organizationId: ctx.organizationId, employeeId: ctx.employeeId, createdBy: ctx.userId, ...input });
  return doc.toObject();
};

/** The owner, or someone who sees everyone's sales, can fix or remove an entry. */
const findEditable = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('Sale');
  const doc = await SaleEntryModel.findOne({ _id: id, organizationId: ctx.organizationId, deletedAt: null });
  if (!doc) throw notFound('Sale');
  const mine = ctx.employeeId && String(doc.employeeId) === String(ctx.employeeId);
  if (!mine && !canSeeAll(ctx)) throw forbidden();
  return doc;
};

export const updateSale = async (ctx: RequestContext, id: string, input: { date?: string; customer?: string; amount?: number; note?: string }) => {
  const doc = await findEditable(ctx, id);
  if (input.date && input.date > todayKey(ctx.timezone)) throw badRequest('The sale date can’t be in the future', 'FUTURE_DATE');
  Object.assign(doc, input);
  await doc.save();
  return doc.toObject();
};

export const deleteSale = async (ctx: RequestContext, id: string) => {
  const doc = await findEditable(ctx, id);
  doc.deletedAt = new Date();
  await doc.save();
  return { deleted: true };
};
