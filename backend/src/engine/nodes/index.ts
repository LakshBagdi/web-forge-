import { WorkflowNode } from '../types';
import { ExecContext, resolveTemplates } from '../context';
import { evaluateCondition } from '../expr';
import { safeFetch } from '../httpClient';

export interface DecryptedCredential {
  type: string; // bearer | basic | api_key | header
  data: Record<string, string>;
}

export interface NodeServices {
  getCredential: (id: string) => Promise<DecryptedCredential | null>;
  log: (level: string, message: string, data?: any) => void;
  signal: AbortSignal;
}

export interface NodeResult {
  output: any;
  branch?: 'true' | 'false';
}

/** Apply a credential to an outgoing request's headers (secrets injected here only). */
function applyCredential(cred: DecryptedCredential, headers: Record<string, string>) {
  switch (cred.type) {
    case 'bearer':
      headers['authorization'] = `Bearer ${cred.data.token}`;
      break;
    case 'basic':
      headers['authorization'] =
        'Basic ' + Buffer.from(`${cred.data.username}:${cred.data.password}`).toString('base64');
      break;
    case 'api_key':
      headers[cred.data.header || 'x-api-key'] = cred.data.key;
      break;
    case 'header':
      headers[(cred.data.name || '').toLowerCase()] = cred.data.value;
      break;
  }
}

async function runHttp(node: WorkflowNode, ctx: ExecContext, svc: NodeServices): Promise<NodeResult> {
  const cfg = resolveTemplates(node.config, ctx);
  let url: string = cfg.url;
  // Merge query params if provided as an object.
  if (cfg.query && typeof cfg.query === 'object') {
    const u = new URL(url);
    for (const [k, v] of Object.entries(cfg.query)) u.searchParams.set(k, String(v));
    url = u.toString();
  }
  const headers: Record<string, string> = {};
  if (cfg.headers && typeof cfg.headers === 'object') {
    for (const [k, v] of Object.entries(cfg.headers)) headers[k.toLowerCase()] = String(v);
  }
  // Credential id is taken from the RAW config (not templated) — it's an internal ref.
  if (node.config.credentialId) {
    const cred = await svc.getCredential(node.config.credentialId);
    if (!cred) throw new Error('Referenced credential not found');
    applyCredential(cred, headers);
    svc.log('debug', `Applied credential (${cred.type})`);
  }
  let body = cfg.body;
  if (typeof body === 'string' && cfg.bodyType === 'json') {
    try { body = JSON.parse(body); } catch { /* send as string */ }
  }
  svc.log('info', `${(cfg.method || 'GET').toUpperCase()} ${url}`);
  const res = await safeFetch({ url, method: cfg.method, headers, body, timeoutMs: node.timeoutMs });
  svc.log('info', `↳ ${res.status} ${res.statusText} (${res.durationMs}ms)`);

  const failOn = node.config.failOnErrorStatus !== false; // default true
  if (failOn && res.status >= 400) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    (err as any).response = res;
    throw err;
  }
  return { output: { status: res.status, headers: res.headers, body: res.body, durationMs: res.durationMs } };
}

async function runCondition(node: WorkflowNode, ctx: ExecContext, svc: NodeServices): Promise<NodeResult> {
  const result = evaluateCondition(node.config, ctx);
  svc.log('info', `Condition → ${result}`);
  return { output: { result }, branch: result ? 'true' : 'false' };
}

async function runTransform(node: WorkflowNode, ctx: ExecContext): Promise<NodeResult> {
  if (node.config.mapping && typeof node.config.mapping === 'object') {
    return { output: resolveTemplates(node.config.mapping, ctx) };
  }
  if (typeof node.config.template === 'string') {
    return { output: resolveTemplates(node.config.template, ctx) };
  }
  // passthrough: resolve any templates in config.value, else echo trigger input
  return { output: node.config.value !== undefined ? resolveTemplates(node.config.value, ctx) : ctx.input };
}

async function runDelay(node: WorkflowNode, _ctx: ExecContext, svc: NodeServices): Promise<NodeResult> {
  const ms = Math.min(Math.max(Number(node.config.ms) || 0, 0), 120_000);
  svc.log('info', `Delay ${ms}ms`);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    svc.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')); }, { once: true });
  });
  return { output: { waitedMs: ms } };
}

async function runTrigger(_node: WorkflowNode, ctx: ExecContext): Promise<NodeResult> {
  return { output: ctx.input };
}

export async function executeNode(node: WorkflowNode, ctx: ExecContext, svc: NodeServices): Promise<NodeResult> {
  switch (node.type) {
    case 'trigger': return runTrigger(node, ctx);
    case 'http': return runHttp(node, ctx, svc);
    case 'condition': return runCondition(node, ctx, svc);
    case 'transform': return runTransform(node, ctx);
    case 'delay': return runDelay(node, ctx, svc);
    default: throw new Error(`Unknown node type: ${(node as any).type}`);
  }
}
