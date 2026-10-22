import { one, query } from '../db';
import { scheduleCron, removeCron } from '../queue';
import { createRun } from './runs';
import { HttpError } from '../middleware/error';

export async function listSchedules(userId: string, workflowId: string) {
  return query('SELECT id, cron, enabled, created_at FROM schedules WHERE user_id=$1 AND workflow_id=$2', [
    userId, workflowId,
  ]);
}

export async function createSchedule(userId: string, workflowId: string, cron: string) {
  const row = await one<{ id: string }>(
    `INSERT INTO schedules(user_id, workflow_id, cron) VALUES ($1,$2,$3) RETURNING id`,
    [userId, workflowId, cron],
  );
  try {
    await scheduleCron(row!.id, cron);
  } catch (err: any) {
    // Invalid cron pattern: remove the row so we never keep a schedule that can't fire.
    await query('DELETE FROM schedules WHERE id=$1', [row!.id]);
    throw new HttpError(400, `Invalid cron expression: ${err?.message || cron}`);
  }
  return row;
}

export async function deleteSchedule(userId: string, id: string) {
  const row = await one<{ id: string }>('SELECT id FROM schedules WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!row) return;
  await removeCron(id);
  await query('DELETE FROM schedules WHERE id=$1', [id]);
}

/** Called by the worker when a cron fires: spin up a fresh run. */
export async function createRunFromSchedule(scheduleId: string): Promise<string | null> {
  const s = await one<{ workflow_id: string; user_id: string; enabled: boolean }>(
    'SELECT workflow_id, user_id, enabled FROM schedules WHERE id=$1',
    [scheduleId],
  );
  if (!s || !s.enabled) return null;
  const run = await createRun(s.user_id, s.workflow_id, { trigger: 'schedule' });
  return run?.id ?? null;
}

/** Re-register every enabled schedule with the queue at boot (idempotent upsert). */
export async function restoreSchedules() {
  const rows = await query<{ id: string; cron: string }>('SELECT id, cron FROM schedules WHERE enabled=true');
  for (const r of rows) {
    try { await scheduleCron(r.id, r.cron); } catch (e: any) { console.warn(`Schedule ${r.id} skipped: ${e?.message}`); }
  }
}
