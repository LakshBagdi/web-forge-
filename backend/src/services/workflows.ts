import { one, query, pool } from '../db';
import { WorkflowGraph } from '../engine/types';

export interface WorkflowRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  active_version: number | null;
  created_at: string;
  updated_at: string;
}

export async function getWorkflow(userId: string, id: string): Promise<WorkflowRow | null> {
  return one<WorkflowRow>('SELECT * FROM workflows WHERE id=$1 AND user_id=$2', [id, userId]);
}

export async function listWorkflows(userId: string) {
  return query(
    `SELECT w.id, w.name, w.description, w.active_version, w.updated_at,
            (SELECT count(*) FROM runs r WHERE r.workflow_id=w.id) AS run_count
     FROM workflows w WHERE w.user_id=$1 ORDER BY w.updated_at DESC`,
    [userId],
  );
}

export async function createWorkflow(userId: string, name: string, description: string, graph: WorkflowGraph) {
  const wf = await one<WorkflowRow>(
    `INSERT INTO workflows(user_id, name, description, graph) VALUES ($1,$2,$3,$4) RETURNING *`,
    [userId, name, description, JSON.stringify(graph)],
  );
  await saveVersion(wf!.id, graph, 'Initial version');
  await pool.query('UPDATE workflows SET active_version=1 WHERE id=$1', [wf!.id]);
  wf!.active_version = 1;
  return wf!;
}

export async function updateWorkflow(
  userId: string,
  id: string,
  patch: { name?: string; description?: string; graph?: WorkflowGraph },
  newVersion = false,
  note = '',
) {
  const wf = await getWorkflow(userId, id);
  if (!wf) return null;
  const name = patch.name ?? wf.name;
  const description = patch.description ?? wf.description;
  const graph = patch.graph ?? wf.graph;
  let activeVersion = wf.active_version;
  if (newVersion && patch.graph) {
    const v = await nextVersion(id);
    await saveVersion(id, graph, note || `Version ${v}`);
    activeVersion = v;
  }
  const updated = await one<WorkflowRow>(
    `UPDATE workflows SET name=$2, description=$3, graph=$4, active_version=$5, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, name, description, JSON.stringify(graph), activeVersion],
  );
  return updated;
}

export async function duplicateWorkflow(userId: string, id: string) {
  const wf = await getWorkflow(userId, id);
  if (!wf) return null;
  return createWorkflow(userId, `${wf.name} (copy)`, wf.description, wf.graph);
}

export async function deleteWorkflow(userId: string, id: string) {
  await query('DELETE FROM workflows WHERE id=$1 AND user_id=$2', [id, userId]);
}

async function nextVersion(workflowId: string): Promise<number> {
  const row = await one<{ max: number | null }>(
    'SELECT MAX(version) as max FROM workflow_versions WHERE workflow_id=$1',
    [workflowId],
  );
  return (row?.max ?? 0) + 1;
}

export async function saveVersion(workflowId: string, graph: WorkflowGraph, note: string) {
  const v = await nextVersion(workflowId);
  await one(
    `INSERT INTO workflow_versions(workflow_id, version, graph, note) VALUES ($1,$2,$3,$4) RETURNING id`,
    [workflowId, v, JSON.stringify(graph), note],
  );
  return v;
}

export async function listVersions(workflowId: string) {
  return query(
    'SELECT version, note, created_at FROM workflow_versions WHERE workflow_id=$1 ORDER BY version DESC',
    [workflowId],
  );
}

export async function getVersionGraph(workflowId: string, version: number): Promise<WorkflowGraph | null> {
  const row = await one<{ graph: WorkflowGraph }>(
    'SELECT graph FROM workflow_versions WHERE workflow_id=$1 AND version=$2',
    [workflowId, version],
  );
  return row?.graph ?? null;
}
