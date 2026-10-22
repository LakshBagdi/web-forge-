import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { resolveSafeTarget } from './ssrfGuard';
import { config } from '../config';

export interface SafeRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface SafeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: any;
  durationMs: number;
  truncated: boolean;
}

/**
 * Perform an HTTP request with SSRF protection:
 *  - validate scheme/host and resolve to a safe public IP (ssrfGuard)
 *  - CONNECT to that pinned IP (defeats DNS-rebinding between check and connect)
 *  - keep Host header + TLS SNI = original hostname so vhosts/certs still work
 *  - enforce timeout and a max response size
 */
export async function safeFetch(req: SafeRequest): Promise<SafeResponse> {
  const target = await resolveSafeTarget(req.url);
  const original = new URL(req.url);
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const method = (req.method || 'GET').toUpperCase();
  const timeoutMs = req.timeoutMs ?? config.stepTimeoutMs;

  const headers: Record<string, string> = { ...(req.headers || {}) };
  // Normalize header keys to avoid duplicates differing only by case.
  const lowerKeys = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  headers['host'] = original.host;
  if (!lowerKeys.has('user-agent')) headers['user-agent'] = 'FlowForge/1.0';
  if (!lowerKeys.has('accept')) headers['accept'] = '*/*';

  let bodyBuf: Buffer | undefined;
  if (req.body !== undefined && req.body !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof req.body === 'string') bodyBuf = Buffer.from(req.body);
    else { bodyBuf = Buffer.from(JSON.stringify(req.body)); if (!lowerKeys.has('content-type')) headers['content-type'] = 'application/json'; }
    headers['content-length'] = String(bodyBuf.length);
  }

  const started = Date.now();
  return new Promise<SafeResponse>((resolve, reject) => {
    const options: https.RequestOptions = {
      host: target.ip, // connect to validated IP
      port: target.port,
      method,
      path: original.pathname + original.search,
      headers,
      timeout: timeoutMs,
      servername: isHttps ? original.hostname : undefined, // SNI
      // Don't fail the demo on self-signed certs of the target; we only READ responses.
      rejectUnauthorized: false,
    };
    const request = lib.request(options, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let truncated = false;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total <= config.maxHttpResponseBytes) chunks.push(c);
        else { truncated = true; res.destroy(); }
      });
      res.on('end', () => finish());
      res.on('close', () => finish());
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        const raw = Buffer.concat(chunks).toString('utf8');
        const ct = String(res.headers['content-type'] || '');
        let body: any = raw;
        if (ct.includes('application/json')) { try { body = JSON.parse(raw); } catch { /* keep raw */ } }
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) respHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        resolve({
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: respHeaders,
          body,
          durationMs: Date.now() - started,
          truncated,
        });
      }
    });
    request.on('timeout', () => { request.destroy(new Error(`Request timed out after ${timeoutMs}ms`)); });
    request.on('error', (err) => reject(err));
    if (bodyBuf) request.write(bodyBuf);
    request.end();
  });
}
