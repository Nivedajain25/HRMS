/**
 * Dedicated background worker (no HTTP server).
 *
 *   node dist/jobs/worker.js        (production, after `pnpm build`)
 *
 * Requires REDIS_URL: jobs are consumed from the shared BullMQ queue.
 * Deployment with a dedicated worker:
 *  - API:    RUN_WORKER=false (don't consume jobs) and ENABLE_JOBS=false
 *            (don't schedule) — otherwise recurring jobs are scheduled twice.
 *  - Worker: consumes every job; also runs the cron scheduler unless
 *            RUN_SCHEDULER=false (e.g. when running several worker replicas,
 *            enable the scheduler on exactly one of them).
 */
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { startScheduler, stopScheduler } from './index';
import { registerAllJobs } from './all';
import { closeQueue, initQueue } from './queue';

const start = async () => {
  if (!env.REDIS_URL) {
    logger.fatal('The dedicated worker requires REDIS_URL (without Redis, jobs run inside the API process).');
    process.exit(1);
  }
  await connectDatabase();
  // Load every service module so ad-hoc job handlers registered on import
  // (not only the scheduled ones) are available. No HTTP server is started.
  await import('../routes/index');
  registerAllJobs();
  await initQueue({ startWorker: true });
  const scheduling = process.env.RUN_SCHEDULER !== 'false';
  if (scheduling) startScheduler();
  logger.info({ scheduler: scheduling }, 'Stencil worker started');

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, stopping worker`);
    stopScheduler();
    await closeQueue();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

start().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
