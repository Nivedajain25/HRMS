import type { ClientSession, Types } from 'mongoose';
import { CounterModel } from '../models';

/** Atomically increments and returns a per-organization sequence. */
export const nextSequence = async (organizationId: Types.ObjectId, key: string, session?: ClientSession) => {
  const doc = await CounterModel.findOneAndUpdate(
    { organizationId, key },
    { $inc: { value: 1 } },
    { upsert: true, new: true, session },
  ).lean();
  return doc!.value;
};

export const formatSequence = (prefix: string, value: number, width = 4) => `${prefix}${String(value).padStart(width, '0')}`;
