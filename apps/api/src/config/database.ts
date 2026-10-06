import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

// Unknown filter paths are dropped. Operator injection is prevented by the
// `sanitizeInput` middleware plus Zod validation on every request.
mongoose.set('strictQuery', true);

let transactionsSupported = false;

export const connectDatabase = async (uri = env.MONGODB_URI) => {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: true });
  transactionsSupported = await detectTransactions();
  logger.info(
    { transactions: transactionsSupported },
    `MongoDB connected (${mongoose.connection.host}/${mongoose.connection.name})`,
  );
  return mongoose.connection;
};

/**
 * Server start-up: keep trying to connect instead of crashing, with a short, actionable log line.
 * The usual failure with MongoDB Atlas is that this machine's public IP changed and is not on the
 * cluster's IP access list — once it is added, the next attempt succeeds without a restart.
 */
export const connectDatabaseWithRetry = async (retryMs = 10_000) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connectDatabase();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const atlasIpBlocked = /whitelist|IP address|access list/i.test(message);
      logger.error(
        { attempt, retryInSeconds: retryMs / 1000 },
        atlasIpBlocked
          ? 'Cannot reach MongoDB Atlas: this computer’s IP is not on the cluster’s IP access list. In Atlas → Security → Database & Network Access → IP Access List, add the current IP (or 0.0.0.0/0). Retrying automatically…'
          : `Cannot connect to MongoDB (${message.split('\n')[0]}). Retrying automatically…`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
};

export const disconnectDatabase = () => mongoose.disconnect();

const detectTransactions = async () => {
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    return false;
  }
};

export const supportsTransactions = () => transactionsSupported;

export const databaseStatus = () => {
  const states: Record<number, string> = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  return states[mongoose.connection.readyState] ?? 'unknown';
};
