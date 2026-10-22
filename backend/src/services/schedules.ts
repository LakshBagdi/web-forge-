import { one, query } from '../db';
import { scheduleCron, removeCron } from '../queue';
import { createRun } from './runs';

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
  await scheduleCron(row!.id, cron, async () => (await createRunFromSchedule(row!.id)) || '');
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
