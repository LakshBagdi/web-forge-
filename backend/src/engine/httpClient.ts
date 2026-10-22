import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
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
export async function safeFetch(req: SafeRequest, redirectsLeft = 5): Promise<SafeResponse> {
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
  if (!lowerKeys.has('accept')) headers['accept'] = 'application/json, text/plain, */*';
  if (!lowerKeys.has('accept-encoding')) headers['accept-encoding'] = 'gzip, deflate, br';

  let bodyBuf: Buffer | undefined;
  if (req.body !== undefined && req.body !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof req.body === 'string') bodyBuf = Buffer.from(req.body);
    else if (/x-www-form-urlencoded/i.test(String(headers['content-type'] || headers['Content-Type'] || '')) && typeof req.body === 'object') {
      bodyBuf = Buffer.from(new URLSearchParams(Object.entries(req.body).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])).toString());
    } else { bodyBuf = Buffer.from(JSON.stringify(req.body)); if (!lowerKeys.has('content-type')) headers['content-type'] = 'application/json'; }
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
        let buf = Buffer.concat(chunks);
        try {
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          if (enc === 'gzip' || enc === 'x-gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch { /* cut-off or bad compression: use what we have */ }
        const raw = buf.toString('utf8');
        const ct = String(res.headers['content-type'] || '');
        let body: any = raw;
        // Parse JSON by content-type (application/json, +json, text/json) or when plain text clearly is JSON (raw.githubusercontent etc.)
        if (/json/i.test(ct) || ((ct === '' || /text\/plain/i.test(ct)) && /^\s*[\[{]/.test(raw))) { try { body = JSON.parse(raw); } catch { /* keep raw */ } }
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) respHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        const loc = res.headers['location'];
        const code = res.statusCode || 0;
        if (loc && [301, 302, 303, 307, 308].includes(code) && redirectsLeft > 0) {
          try {
            const next = new URL(String(loc), original).toString();
            const sameHost = new URL(next).host === original.host;
            const toGet = code === 303 || ((code === 301 || code === 302) && method === 'POST');
            const nh = { ...(req.headers || {}) };
            for (const k of Object.keys(nh)) if (/^(host|content-length)$/i.test(k) || (!sameHost && /^(authorization|cookie)$/i.test(k)) || (toGet && /^content-type$/i.test(k))) delete nh[k];
            safeFetch({ url: next, method: toGet ? 'GET' : method, headers: nh, body: toGet ? undefined : req.body, timeoutMs }, redirectsLeft - 1)
              .then((r) => resolve({ ...r, durationMs: Date.now() - started }), reject);
            return;
          } catch (e) { reject(e); return; }
        }
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
