import { env } from './config/env';
import { connectDatabaseWithRetry, disconnectDatabase } from './config/database';
import { logger } from './config/logger';
import { createApp } from './app';
import { closeQueue, initQueue } from './jobs/queue';
import { startScheduler, stopScheduler } from './jobs';
import { registerAllJobs } from './jobs/all';
import { ensureSystemRoles, syncPermissionCatalog } from './services/organization-setup.service';

const start = async () => {
  await connectDatabaseWithRetry();
  await syncPermissionCatalog();
  await ensureSystemRoles();
  registerAllJobs();
  // The API process also runs the worker unless a dedicated worker is deployed.
  await initQueue({ startWorker: process.env.RUN_WORKER !== 'false' });
  if (env.ENABLE_JOBS) startScheduler();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Stencil HRMS API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    logger.info(`API docs: http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close();
    stopScheduler();
    await closeQueue();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
