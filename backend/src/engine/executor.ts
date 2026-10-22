import { WorkflowGraph, WorkflowNode, NodeRunState } from './types';
import { topoOrder, nodeMap, incoming, outgoing } from './dag';
import { ExecContext } from './context';
import { executeNode, NodeServices, DecryptedCredential } from './nodes';
import { getCredentialDecrypted } from '../services/credentials';
import { getRun, setRunStatus, saveNodeState, appendLog } from '../services/runStore';
import { config } from '../config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function descendants(graph: WorkflowGraph, roots: Set<string>): Set<string> {
  const out = new Set<string>(roots);
  const adj = new Map<string, string[]>();
  graph.nodes.forEach((n) => adj.set(n.id, []));
  graph.edges.forEach((e) => adj.get(e.source)?.push(e.target));
  const stack = [...roots];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const nxt of adj.get(cur) ?? []) if (!out.has(nxt)) { out.add(nxt); stack.push(nxt); }
  }
  return out;
}

/**
 * Execute a run to completion. Honors execution dependencies (topological),
 * conditional branch skipping, per-node retries & timeouts, failure recovery,
 * and controlled re-execution (a retry run reuses successful upstream outputs).
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error('Run not found');
  if (run.status === 'cancelled') return;

  const graph: WorkflowGraph = run.graph;
  const map = nodeMap(graph);
  const order = topoOrder(graph);

  // Seed from parent run on retry: keep successes, re-run the rest + descendants.
  const seed: Record<string, NodeRunState> = run.node_state || {};
  let reuse = new Set<string>();
  if (run.parent_run_id) {
    const notSuccess = new Set(
      graph.nodes.filter((n) => seed[n.id]?.status !== 'success').map((n) => n.id),
    );
    const mustRerun = descendants(graph, notSuccess);
    reuse = new Set(graph.nodes.map((n) => n.id).filter((id) => !mustRerun.has(id) && seed[id]?.status === 'success'));
  }

  const nodeState = new Map<string, NodeRunState>();
  const ctx: ExecContext = { trigger: { input: run.input }, input: run.input, steps: {}, vars: {} };

  // Preload reused node outputs into context and mark them success.
  for (const id of reuse) {
    const st = seed[id];
    nodeState.set(id, st);
    ctx.steps[id] = { output: st.output, status: 'success' };
    await saveNodeState(runId, id, st);
  }

  await setRunStatus(runId, 'running');
  await appendLog(runId, null, 'info', `Run started (version ${run.version}${run.parent_run_id ? ', retry' : ''})`);

  const credCache = new Map<string, DecryptedCredential | null>();
  let executed = 0;

  try {
    for (const nodeId of order) {
      if (reuse.has(nodeId)) continue;
      const node = map.get(nodeId)!;

      // Decide: run or skip, based on incoming edges.
      const ins = incoming(graph, nodeId);
      if (node.type !== 'trigger' && ins.length > 0) {
        const live = ins.some((e) => {
          const src = nodeState.get(e.source);
          if (!src || src.status !== 'success') return false;
          const srcNode = map.get(e.source);
          if (srcNode?.type === 'condition' && e.sourceHandle) {
            return src.branch === e.sourceHandle;
          }
          return true;
        });
        if (!live) {
          const skipped: NodeRunState = { status: 'skipped', attempts: 0 };
          nodeState.set(nodeId, skipped);
          await saveNodeState(runId, nodeId, skipped);
          await appendLog(runId, nodeId, 'debug', `Skipped "${node.label || nodeId}" (branch not taken)`);
          continue;
        }
      }

      if (++executed > config.maxStepsPerRun) throw new Error('Exceeded maximum steps per run');

      const result = await runNodeWithRetry(runId, node, ctx, credCache);
      nodeState.set(nodeId, result);
      if (result.status === 'failed') {
        await setRunStatus(runId, 'failed', `Node "${node.label || nodeId}" failed: ${result.error}`);
        await appendLog(runId, null, 'error', `Run failed at "${node.label || nodeId}"`);
        return;
      }
      ctx.steps[nodeId] = { output: result.output, status: 'success' };
    }

    await setRunStatus(runId, 'success');
    await appendLog(runId, null, 'info', 'Run completed successfully');
  } catch (err: any) {
    await setRunStatus(runId, 'failed', err?.message || String(err));
    await appendLog(runId, null, 'error', `Run aborted: ${err?.message || err}`);
  }
}

async function runNodeWithRetry(
  runId: string,
  node: WorkflowNode,
  ctx: ExecContext,
  credCache: Map<string, DecryptedCredential | null>,
): Promise<NodeRunState> {
  const maxAttempts = Math.max(1, node.retry?.maxAttempts ?? 1);
  const backoff = Math.max(0, node.retry?.backoffMs ?? 500);
  const timeoutMs = node.timeoutMs ?? config.stepTimeoutMs;

  const state: NodeRunState = { status: 'running', attempts: 0, startedAt: new Date().toISOString() };
  await saveNodeState(runId, node.id, state);
  await appendLog(runId, node.id, 'info', `Executing "${node.label || node.id}" (${node.type})`);

  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    state.attempts = attempt;
    const controller = new AbortController();
    const svc: NodeServices = {
      getCredential: async (id) => {
        if (!credCache.has(id)) credCache.set(id, await getCredentialDecrypted(id));
        return credCache.get(id)!;
      },
      log: (level, message, data) => { void appendLog(runId, node.id, level, message, data); },
      signal: controller.signal,
    };
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await Promise.race([
        executeNode(node, ctx, svc),
        new Promise<never>((_, rej) =>
          controller.signal.addEventListener('abort', () => rej(new Error(`Timed out after ${timeoutMs}ms`)), { once: true }),
        ),
      ]);
      clearTimeout(timer);
      const done: NodeRunState = {
        status: 'success',
        attempts: attempt,
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        output: res.output,
        branch: res.branch,
      };
      await saveNodeState(runId, node.id, done);
      return done;
    } catch (err: any) {
      clearTimeout(timer);
      controller.abort();
      lastErr = err?.message || String(err);
      await appendLog(runId, node.id, 'warn', `Attempt ${attempt}/${maxAttempts} failed: ${lastErr}`);
      if (attempt < maxAttempts) {
        const wait = Math.min(backoff * 2 ** (attempt - 1), 10_000);
        await appendLog(runId, node.id, 'debug', `Retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  const failed: NodeRunState = {
    status: 'failed',
    attempts: maxAttempts,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    error: lastErr,
  };
  await saveNodeState(runId, node.id, failed);
  await appendLog(runId, node.id, 'error', `"${node.label || node.id}" failed after ${maxAttempts} attempt(s): ${lastErr}`);
  return failed;
}

export { outgoing };
