import { one, query, pool } from '../db';
import { emitRunEvent } from '../events';
import { NodeRunState, RunStatus } from '../engine/types';

export interface RunRow {
  id: string;
  workflow_id: string;
  user_id: string;
  version: number;
  graph: any;
  status: RunStatus;
  trigger: string;
  input: any;
  node_state: Record<string, NodeRunState>;
  error: string | null;
  parent_run_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export async function getRun(id: string): Promise<RunRow | null> {
  return one<RunRow>('SELECT * FROM runs WHERE id=$1', [id]);
}

export async function setRunStatus(id: string, status: RunStatus, error?: string | null) {
  const setStarted = status === 'running';
  const setFinished = ['success', 'failed', 'cancelled'].includes(status);
  // A cancelled run is final: later writes from a still-executing worker must not revive it.
  const res = await pool.query(
    `UPDATE runs SET status=$2, error=$3,
       started_at = COALESCE(started_at, CASE WHEN $4 THEN now() ELSE NULL END),
       finished_at = CASE WHEN $5 THEN now() ELSE finished_at END
     WHERE id=$1 AND (status <> 'cancelled' OR $2 = 'cancelled')`,
    [id, status, error ?? null, setStarted, setFinished],
  );
  if (res.rowCount) emitRunEvent({ type: 'run.status', runId: id, payload: { status, error: error ?? null } });
}

export async function isCancelled(id: string): Promise<boolean> {
  const r = await one<{ status: string }>('SELECT status FROM runs WHERE id=$1', [id]);
  return !r || r.status === 'cancelled';
}

export async function saveNodeState(runId: string, nodeId: string, state: NodeRunState) {
  // jsonb_set the single node key so concurrent node updates don't clobber each other.
  await pool.query(
    `UPDATE runs SET node_state = jsonb_set(COALESCE(node_state,'{}'::jsonb), $2, $3::jsonb, true)
     WHERE id=$1`,
    [runId, `{${nodeId}}`, JSON.stringify(state)],
  );
  emitRunEvent({ type: 'node.status', runId, payload: { nodeId, state } });
}

export async function appendLog(runId: string, nodeId: string | null, level: string, message: string, data?: any) {
  const row = await one<{ id: string; ts: string }>(
    `INSERT INTO run_logs(run_id, node_id, level, message, data)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, ts`,
    [runId, nodeId, level, message, data ? JSON.stringify(data) : null],
  );
  emitRunEvent({ type: 'log', runId, payload: { id: row?.id, nodeId, level, message, data, ts: row?.ts } });
}

export async function listLogs(runId: string, afterId = 0) {
  return query(
    `SELECT id, node_id as "nodeId", level, message, data, ts FROM run_logs
     WHERE run_id=$1 AND id > $2 ORDER BY id ASC LIMIT 2000`,
    [runId, afterId],
  );
}
