import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../config/logger';
import { enqueue, registerJobHandler } from './queue';

interface ScheduledJob {
  name: string;
  /** cron expression, evaluated in UTC */
  schedule: string;
  handler: () => Promise<void>;
}

const scheduled: ScheduledJob[] = [];
const tasks: ScheduledTask[] = [];

/** Registers a recurring job; it is dispatched through the queue so it runs on a worker. */
export const defineScheduledJob = (job: ScheduledJob) => {
  scheduled.push(job);
};

export const registerJobs = () => {
  for (const job of scheduled) registerJobHandler(job.name, () => job.handler());
};

export const startScheduler = () => {
  for (const job of scheduled) {
    tasks.push(
      cron.schedule(
        job.schedule,
        () => {
          // Minute-granular id: dedupes duplicate ticks without swallowing sub-hourly schedules.
          enqueue(job.name, {}, { jobId: `${job.name}:${new Date().toISOString().slice(0, 16)}` }).catch((err) =>
            logger.error({ err, job: job.name }, 'Failed to enqueue scheduled job'),
          );
        },
        { timezone: 'UTC' },
      ),
    );
  }
  logger.info({ jobs: scheduled.map((j) => j.name) }, 'Scheduler started');
};

export const stopScheduler = () => {
  for (const t of tasks) t.stop();
  tasks.length = 0;
};

export const runScheduledJobNow = async (name: string) => {
  const job = scheduled.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job ${name}`);
  await job.handler();
};
