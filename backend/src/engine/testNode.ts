import { ExecContext, makeNow, unresolvedRefs } from './context';
import { WorkflowNode } from './types';
import { executeNode, NodeServices } from './nodes';
import { getCredentialDecrypted, updateCredentialData } from '../services/credentials';
import { one } from '../db';

const TESTABLE = ['http', 'transform', 'condition'];
/**
 * Run ONE node on its own with the saved credentials, using the data from this workflow's most recent run
 * as the output of earlier steps. Nothing is saved: no run is created and Watch memory is untouched.
 * It really sends the HTTP request (that is the point of testing it).
 */
export async function testNode(userId: string, workflowId: string, node: WorkflowNode, input: any) {
  if (!TESTABLE.includes(node.type)) {
    return { ok: false, error: `A ${node.type} step can't be tested alone. Press Run to try the whole workflow.`, logs: [], unresolved: [] };
  }
  const last = await one<{ node_state: Record<string, any> }>(
    'SELECT node_state FROM runs WHERE workflow_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1', [workflowId, userId]);
  const steps: ExecContext['steps'] = {};
  for (const [id, st] of Object.entries(last?.node_state ?? {})) {
    if (st && st.status === 'success') steps[id] = { output: st.output, status: 'success' };
  }
  const ctx: ExecContext = { trigger: { input }, input, steps, vars: {}, now: makeNow() };
  const logs: { level: string; message: string }[] = [];
  const controller = new AbortController();
  const timeoutMs = Math.min(30_000, node.timeoutMs && node.timeoutMs >= 100 ? node.timeoutMs : 15_000);
  const svc: NodeServices = {
    getCredential: (id) => getCredentialDecrypted(id, userId),
    updateCredential: (id, data) => updateCredentialData(id, userId, data),
    swapWatchValue: async () => null,
    log: (level, message) => { logs.push({ level, message }); },
    signal: controller.signal,
  };
  const unresolved = unresolvedRefs(node.config, ctx);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await Promise.race([
      executeNode(node, ctx, svc),
      new Promise<never>((_, rej) => controller.signal.addEventListener('abort', () => rej(new Error(`Timed out after ${timeoutMs}ms`)), { once: true })),
    ]);
    let output = res.output;
    const text = JSON.stringify(output) ?? '';
    if (text.length > 200_000) output = { truncated: true, preview: text.slice(0, 200_000) };
    return { ok: true, output, branch: res.branch, logs, unresolved };
  } catch (err: any) {
    const resp = err?.response;
    return { ok: false, error: err?.message || String(err), response: resp ? { status: resp.status, body: resp.body } : undefined, logs, unresolved };
  } finally { clearTimeout(timer); }
}
