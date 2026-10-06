import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../config/database';

/**
 * Runs `fn` inside a MongoDB transaction when the deployment supports it
 * (replica set / sharded). On a standalone server (local dev) it runs without
 * one — callers must still pass `session` to every operation.
 */
export const withTransaction = async <T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> => {
  if (!supportsTransactions()) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};
