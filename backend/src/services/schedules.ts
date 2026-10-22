import { one, query } from '../db';
import { scheduleCron, removeCron, scheduleOnce } from '../queue';
import { createRun } from './runs';
import { HttpError } from '../middleware/error';

const COLS = 'id, cron, tz, run_at, fired_at, enabled, created_at';

export function validTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export async function listSchedules(userId: string, workflowId: string) {
  return query(`SELECT ${COLS} FROM schedules WHERE user_id=$1 AND workflow_id=$2 ORDER BY created_at DESC`, [userId, workflowId]);
}

/** Repeating (cron + timezone) or one-time (runAt). Exactly one of cron / runAt. */
export async function createSchedule(userId: string, workflowId: string, opts: { cron?: string; runAt?: string; tz?: string }) {
  const tz = opts.tz || 'UTC';
  if (!validTimeZone(tz)) throw new HttpError(400, `Unknown timezone: ${tz}`);
  if (!!opts.cron === !!opts.runAt) throw new HttpError(400, 'Provide either a cron expression or a one-time run time');

  if (opts.runAt) {
    const at = new Date(opts.runAt);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, 'Invalid date/time');
    if (at.getTime() < Date.now() + 5_000) throw new HttpError(400, 'Pick a time in the future');
    const row = await one<{ id: string }>(
      `INSERT INTO schedules(user_id, workflow_id, run_at, tz) VALUES ($1,$2,$3,$4) RETURNING id`,
      [userId, workflowId, at.toISOString(), tz],
    );
    await scheduleOnce(row!.id, at);
    return row;
  }

  const row = await one<{ id: string }>(
    `INSERT INTO schedules(user_id, workflow_id, cron, tz) VALUES ($1,$2,$3,$4) RETURNING id`,
    [userId, workflowId, opts.cron, tz],
  );
  try {
    await scheduleCron(row!.id, opts.cron!, tz);
  } catch (err: any) {
    // Invalid cron pattern: remove the row so we never keep a schedule that can't fire.
    await query('DELETE FROM schedules WHERE id=$1', [row!.id]);
    throw new HttpError(400, `Invalid cron expression: ${err?.message || opts.cron}`);
  }
  return row;
}

export async function deleteSchedule(userId: string, id: string) {
  const row = await one<{ id: string }>('SELECT id FROM schedules WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!row) return;
  await removeCron(id);
  await query('DELETE FROM schedules WHERE id=$1', [id]);
}

/** Called by the worker when a schedule fires: spin up a fresh run. */
export async function createRunFromSchedule(scheduleId: string): Promise<string | null> {
  const s = await one<{ workflow_id: string; user_id: string; enabled: boolean; run_at: string | null }>(
    'SELECT workflow_id, user_id, enabled, run_at FROM schedules WHERE id=$1',
    [scheduleId],
  );
  if (!s || !s.enabled) return null;
  if (s.run_at) {
    // One-time schedule: mark it spent so it can never fire twice (e.g. after a restart).
    await query('UPDATE schedules SET enabled=false, fired_at=now() WHERE id=$1', [scheduleId]);
  }
  const run = await createRun(s.user_id, s.workflow_id, { trigger: 'schedule' });
  return run?.id ?? null;
}

/** Re-register schedules with the queue at boot (idempotent). Covers a wiped Redis or downtime. */
export async function restoreSchedules() {
  const rows = await query<{ id: string; cron: string | null; tz: string; run_at: string | null; fired_at: string | null; enabled: boolean }>(
    'SELECT id, cron, tz, run_at, fired_at, enabled FROM schedules WHERE enabled=true');
  for (const r of rows) {
    try {
      if (r.cron) { await scheduleCron(r.id, r.cron, r.tz); continue; }
      if (r.run_at && !r.fired_at) {
        const at = new Date(r.run_at);
        const lateMs = Date.now() - at.getTime();
        if (lateMs <= 0) await scheduleOnce(r.id, at);                       // still in the future
        else if (lateMs <= 15 * 60_000) await scheduleOnce(r.id, new Date()); // missed by <15 min during downtime: run now
        else await query('UPDATE schedules SET enabled=false WHERE id=$1', [r.id]); // too late to be useful: mark missed
      }
    } catch (e: any) { console.warn(`Schedule ${r.id} skipped: ${e?.message}`); }
  }
}
