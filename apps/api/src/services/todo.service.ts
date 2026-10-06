import { Types } from 'mongoose';
import { TODO_COLORS } from '@stencil/shared';
import { TodoModel } from '../models';
import type { RequestContext } from '../types/context';
import { notFound } from '../utils/errors';

type TodoColor = (typeof TODO_COLORS)[number];

const mine = (ctx: RequestContext) => ({ organizationId: ctx.organizationId, userId: ctx.userId });

/** My to-dos for a day, in list order. */
export const listTodos = (ctx: RequestContext, q: { date: string }) => TodoModel.find({ ...mine(ctx), date: q.date }).sort({ order: 1, createdAt: 1 }).lean();

/** Adds a to-do at the bottom of the day; without a colour it takes the next one in the palette. */
export const createTodo = async (ctx: RequestContext, input: { title: string; date: string; color?: TodoColor }) => {
  const count = await TodoModel.countDocuments({ ...mine(ctx), date: input.date });
  const last = await TodoModel.findOne({ ...mine(ctx), date: input.date }).sort({ order: -1 }).select('order').lean();
  const doc = await TodoModel.create({
    ...mine(ctx),
    title: input.title,
    date: input.date,
    color: input.color ?? TODO_COLORS[count % TODO_COLORS.length],
    order: (last?.order ?? -1) + 1,
  });
  return doc.toObject();
};

export const updateTodo = async (ctx: RequestContext, id: string, input: { title?: string; done?: boolean; color?: TodoColor }) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('To-do');
  const doc = await TodoModel.findOneAndUpdate({ _id: id, ...mine(ctx) }, { $set: input }, { new: true }).lean();
  if (!doc) throw notFound('To-do');
  return doc;
};

export const deleteTodo = async (ctx: RequestContext, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound('To-do');
  const res = await TodoModel.deleteOne({ _id: id, ...mine(ctx) });
  if (!res.deletedCount) throw notFound('To-do');
  return { deleted: true };
};

/** Saves a new order (ids top to bottom); ids that aren't mine are ignored. */
export const reorderTodos = async (ctx: RequestContext, ids: string[]) => {
  await TodoModel.bulkWrite(ids.map((id, order) => ({ updateOne: { filter: { _id: new Types.ObjectId(id), ...mine(ctx) }, update: { $set: { order } } } })));
  return { updated: ids.length };
};
