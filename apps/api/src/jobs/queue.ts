import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';

/**
 * Background job abstraction.
 *  - With REDIS_URL: jobs go through BullMQ (retries, persistence, separate workers).
 *  - Without Redis: jobs run in-process asynchronously (dev / small installs).
 */
export type JobHandler<T = unknown> = (data: T) => Promise<void>;

const handlers = new Map<string, JobHandler>();
let queue: Queue | null = null;
let worker: Worker | null = null;
let connection: Redis | null = null;
const QUEUE_NAME = 'stencil-jobs';

export const registerJobHandler = <T>(name: string, handler: JobHandler<T>) => {
  handlers.set(name, handler as JobHandler);
};

const runInline = (name: string, data: unknown) => {
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn({ job: name }, 'No handler registered for job');
    return;
  }
  // Detach from the request so the caller never waits on or fails because of the job.
  setImmediate(() => {
    handler(data).catch((err) => logger.error({ err, job: name }, 'Inline job failed'));
  });
};

export const enqueue = async (name: string, data: unknown, opts: { delayMs?: number; jobId?: string } = {}) => {
  if (queue) {
    await queue.add(name, data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      delay: opts.delayMs,
      jobId: opts.jobId,
    });
    return;
  }
  if (isTest) {
    // Deterministic in tests: run synchronously.
    await handlers.get(name)?.(data);
    return;
  }
  runInline(name, data);
};

export const initQueue = async ({ startWorker }: { startWorker: boolean }) => {
  if (!env.REDIS_URL || isTest) {
    logger.info('Background jobs: in-process mode (set REDIS_URL to use BullMQ)');
    return;
  }
  connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(QUEUE_NAME, { connection });
  if (startWorker) {
    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        const handler = handlers.get(job.name);
        if (!handler) throw new Error(`No handler for job ${job.name}`);
        await handler(job.data);
      },
      { connection, concurrency: 5 },
    );
    worker.on('failed', (job, err) => logger.error({ err, job: job?.name }, 'Job failed'));
  }
  logger.info({ worker: startWorker }, 'Background jobs: BullMQ mode');
};

export const usingRedis = () => queue !== null;

export const closeQueue = async () => {
  await worker?.close();
  await queue?.close();
  connection?.disconnect();
};
