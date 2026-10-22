import crypto from 'crypto';
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
  updateCredential: (id: string, data: Record<string, string>) => Promise<void>;
  /** Store the new value, return the previous one (null on the first check). Atomic. */
  swapWatchValue: (nodeId: string, value: string) => Promise<string | null>;
  log: (level: string, message: string, data?: any) => void;
  signal: AbortSignal;
}

export interface NodeResult {
  output: any;
  branch?: 'true' | 'false';
}

/**
 * OAuth2 refresh-token flow: exchange the long-lived refresh token for a short-lived access token
 * (once per run, cached on the decrypted credential object). If the provider rotates the refresh
 * token (X/Twitter does), the new one is stored so the next run keeps working.
 */
async function oauthAccessToken(credId: string, cred: DecryptedCredential, svc: NodeServices): Promise<string> {
  const cached = (cred as any)._at as { token: string; exp: number } | undefined;
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const d = cred.data;
  for (const k of ['token_url', 'client_id', 'refresh_token']) {
    if (!d[k]) throw new Error(`OAuth credential is missing "${k}"`);
  }
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.refresh_token });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (d.client_auth === 'basic') {
    headers.authorization = 'Basic ' + Buffer.from(`${d.client_id}:${d.client_secret || ''}`).toString('base64');
  } else {
    form.set('client_id', d.client_id);
    if (d.client_secret) form.set('client_secret', d.client_secret);
  }
  if (d.scope) form.set('scope', d.scope);
  const res = await safeFetch({ url: d.token_url, method: 'POST', headers, body: form.toString(), timeoutMs: 15_000 });
  const b = res.body && typeof res.body === 'object' ? res.body : {};
  if (res.status >= 400 || !b.access_token) {
    // Provider error text only; never include secrets.
    throw new Error(`OAuth token refresh failed (HTTP ${res.status}${b.error ? `: ${b.error}` : ''})`);
  }
  if (b.refresh_token && b.refresh_token !== d.refresh_token) {
    d.refresh_token = String(b.refresh_token);
    await svc.updateCredential(credId, d);
    svc.log('debug', 'Provider rotated the refresh token; stored the new one');
  }
  const exp = Date.now() + (Number(b.expires_in) > 0 ? Number(b.expires_in) * 1000 : 3_000_000);
  (cred as any)._at = { token: String(b.access_token), exp };
  return String(b.access_token);
}

/** Apply a credential to an outgoing request's headers (secrets injected here only). */
async function applyCredential(credId: string, cred: DecryptedCredential, headers: Record<string, string>, svc: NodeServices) {
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
    case 'oauth2':
      headers['authorization'] = `Bearer ${await oauthAccessToken(credId, cred, svc)}`;
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
    await applyCredential(node.config.credentialId, cred, headers, svc);
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

async function runWatch(node: WorkflowNode, ctx: ExecContext, svc: NodeServices): Promise<NodeResult> {
  const raw = resolveTemplates(node.config.value, ctx);
  if (raw === undefined || raw === null || raw === '') throw new Error('Watch value is empty, nothing to compare');
  const current = typeof raw === 'string' ? raw : JSON.stringify(raw);
  // The memory is keyed by node id + a hash of the "value to watch" template, so pointing the node at
  // something else (another channel, another field) starts a fresh baseline instead of a false "changed".
  const key = `${node.id}:${crypto.createHash('sha1').update(String(node.config.value)).digest('hex').slice(0, 8)}`;
  const previous = await svc.swapWatchValue(key, current);
  const first = previous === null;
  const changed = first ? node.config.fireOnFirstRun === true : previous !== current;
  const short = (v: string) => (v.length > 100 ? v.slice(0, 100) + '…' : v);
  svc.log('info', first
    ? `First check: saved baseline "${short(current)}"${changed ? ' (firing because "run on first check" is on)' : ' (not firing)'}`
    : changed ? `Changed: "${short(previous!)}" → "${short(current)}"` : `No change ("${short(current)}")`);
  return { output: { changed, first, previous, current: raw }, branch: changed ? 'true' : 'false' };
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
    case 'watch': return runWatch(node, ctx, svc);
    default: throw new Error(`Unknown node type: ${(node as any).type}`);
  }
}
