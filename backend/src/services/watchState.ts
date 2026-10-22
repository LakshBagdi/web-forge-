import { one } from '../db';

/**
 * Atomically store `value` for this Watch node and return what was stored before (null = first check).
 * The UPDATE locks the row while it reads the old value, so two overlapping runs can never both see
 * the same "change" and both fire: the second waits, then compares against the freshly stored value.
 */
export async function swapWatchValue(workflowId: string, nodeId: string, value: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const upd = await one<{ previous: string }>(
      `UPDATE workflow_state s SET value=$3, updated_at=now()
         FROM (SELECT value FROM workflow_state WHERE workflow_id=$1 AND node_id=$2 FOR UPDATE) o
        WHERE s.workflow_id=$1 AND s.node_id=$2
        RETURNING o.value AS previous`,
      [workflowId, nodeId, value],
    );
    if (upd) return upd.previous;
    // No row yet: this is the first check. If another run inserted it a moment ago, loop and compare instead.
    const ins = await one<{ ok: number }>(
      `INSERT INTO workflow_state(workflow_id, node_id, value) VALUES ($1,$2,$3)
       ON CONFLICT (workflow_id, node_id) DO NOTHING RETURNING 1 AS ok`,
      [workflowId, nodeId, value],
    );
    if (ins) return null;
  }
  throw new Error('Could not record the watched value (database busy)');
}
