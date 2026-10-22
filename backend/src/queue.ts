import { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
import { executeRun } from './engine/executor';
import { appendLog, setRunStatus } from './services/runStore';

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

// Without these listeners a Redis hiccup (e.g. the free Redis restarting) would crash the whole server.
connection.on('error', (e) => console.warn('[redis]', e?.message));

export const runQueue = new Queue('flowforge-runs', { connection });
runQueue.on('error', (e) => console.warn('[queue]', e?.message));

export interface RunJob {
  runId: string;
}

export async function enqueueRun(runId: string, opts: JobsOptions = {}) {
  await runQueue.add('run', { runId } as RunJob, {
    removeOnComplete: 1000,
    removeOnFail: 1000,
    attempts: 1, // run-level retries are handled inside the engine per-node
    ...opts,
  });
}

/** Schedule a repeatable run via cron (used by the schedules feature). */
export async function scheduleCron(scheduleId: string, cron: string, tz = 'UTC') {
  // A job scheduler fires a lightweight "cron" job on the pattern; the worker
  // then creates a fresh run per fire.
  await runQueue.upsertJobScheduler(
    `cron:${scheduleId}`,
    { pattern: cron, tz },
    { name: 'cron', data: { scheduleId }, opts: { removeOnComplete: 100, removeOnFail: 100 } },
  );
}

/** When a repeating schedule will fire next (epoch ms), or null if unknown. */
export async function nextCronRun(scheduleId: string): Promise<number | null> {
  try { const js = await runQueue.getJobScheduler(`cron:${scheduleId}`); return js?.next ?? null; } catch { return null; }
}

export async function removeCron(scheduleId: string) {
  await runQueue.removeJobScheduler(`cron:${scheduleId}`);
  await removeOnce(scheduleId);
}

/** One-time run at an exact instant: a delayed job (fixed jobId, so re-adding after a restart is a no-op). */
export async function scheduleOnce(scheduleId: string, runAt: Date) {
  const delay = Math.max(0, runAt.getTime() - Date.now());
  await runQueue.add('cron', { scheduleId }, { delay, jobId: `once-${scheduleId}`, removeOnComplete: 100, removeOnFail: 100, attempts: 1 });
}

export async function removeOnce(scheduleId: string) {
  const job = await runQueue.getJob(`once-${scheduleId}`);
  if (job) await job.remove().catch(() => {});
}

let worker: Worker | null = null;

export function startWorker() {
  if (worker) return worker;
  worker = new Worker(
    'flowforge-runs',
    async (job) => {
      if (job.name === 'cron') {
        const { createRunFromSchedule } = await import('./services/schedules');
        await createRunFromSchedule(job.data.scheduleId);
        return;
      }
      const { runId } = job.data as RunJob;
      try {
        await executeRun(runId);
      } catch (err: any) {
        await setRunStatus(runId, 'failed', err?.message || String(err));
        await appendLog(runId, null, 'error', `Worker error: ${err?.message || err}`);
        throw err;
      }
    },
    // maxStalledCount 0: never silently re-run a stalled job (it could repeat side effects)
    { connection, concurrency: config.runConcurrency, maxStalledCount: 0 },
  );
  worker.on('error', (e) => console.warn('[worker]', e?.message));
  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err?.message));
  return worker;
}

export const queueEvents = new QueueEvents('flowforge-runs', { connection });
queueEvents.on('error', (e) => console.warn('[queue-events]', e?.message));
