import { one, query } from '../db';
import { getWorkflow } from './workflows';
import { enqueueRun } from '../queue';
import { WorkflowGraph } from '../engine/types';
import { getRun } from './runStore';

export async function createRun(
  userId: string,
  workflowId: string,
  opts: { trigger?: string; input?: any; graph?: WorkflowGraph; version?: number } = {},
) {
  const wf = await getWorkflow(userId, workflowId);
  if (!wf) return null;
  const graph = opts.graph ?? wf.graph;
  const version = opts.version ?? wf.active_version ?? 1;
  const run = await one(
    `INSERT INTO runs(workflow_id, user_id, version, graph, input, trigger, status)
     VALUES ($1,$2,$3,$4,$5,$6,'queued') RETURNING *`,
    [workflowId, userId, version, JSON.stringify(graph), JSON.stringify(opts.input ?? {}), opts.trigger ?? 'manual'],
  );
  await enqueueRun(run!.id);
  return run;
}

/** Create a retry run that reuses successful steps from the parent. */
export async function retryRun(userId: string, parentRunId: string) {
  const parent = await getRun(parentRunId);
  if (!parent || parent.user_id !== userId) return null;
  const run = await one(
    `INSERT INTO runs(workflow_id, user_id, version, graph, input, trigger, status, parent_run_id, node_state)
     VALUES ($1,$2,$3,$4,$5,'retry','queued',$6,$7) RETURNING *`,
    [
      parent.workflow_id, userId, parent.version, JSON.stringify(parent.graph),
      JSON.stringify(parent.input), parentRunId, JSON.stringify(parent.node_state),
    ],
  );
  await enqueueRun(run!.id);
  return run;
}

export async function listRuns(userId: string, workflowId?: string, limit = 50) {
  if (workflowId) {
    return query(
      `SELECT id, workflow_id, version, status, trigger, error, started_at, finished_at, created_at
       FROM runs WHERE user_id=$1 AND workflow_id=$2 ORDER BY created_at DESC LIMIT $3`,
      [userId, workflowId, limit],
    );
  }
  return query(
    `SELECT id, workflow_id, version, status, trigger, error, started_at, finished_at, created_at
     FROM runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
}
