const BASE = import.meta.env.VITE_API_BASE || '';

let token: string | null = localStorage.getItem('ff_token');

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('ff_token', t);
  else localStorage.removeItem('ff_token');
}
export function getToken() {
  return token;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const DEV = !!(import.meta as any).env?.DEV;
const WAKING = 'FlowForge is waking up (the free server sleeps when nobody is using it, or it is being updated). Wait about a minute, then reload the page — your work is safe.';
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (opts.body) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  const isGet = !opts.method || opts.method.toUpperCase() === 'GET';
  // A sleeping/restarting server answers with a network error or 502/503/504: reading data just tries again a few times (~25 s).
  const tries = !DEV && isGet ? 4 : 1;
  let res: Response | undefined;
  for (let i = 1; i <= tries; i++) {
    // Never wait forever: if the backend is down or stuck, fail with a clear message after 15 s.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      res = await fetch(`${BASE}/api${path}`, { ...opts, headers, signal: ctrl.signal });
      if (![502, 503, 504].includes(res.status) || i === tries) break;
    } catch {
      res = undefined;
      if (i === tries) throw new ApiError(DEV ? 'Cannot reach the server. Is the backend running (npm run dev in the backend folder, port 4000)?' : WAKING, 0);
    } finally { clearTimeout(timer); }
    await sleepMs(3000);
  }
  if (!res) throw new ApiError(WAKING, 0);
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body, e.g. a proxy error page */ }
  if (!res.ok) {
    const proxyDown = res.status >= 500 && !data?.error;
    throw new ApiError(proxyDown ? (DEV ? 'The backend is not responding (is it running on port 4000?)' : WAKING) : (data?.error || `Request failed (${res.status})`), res.status);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>(p),
  post: <T = any>(p: string, body?: any) => request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T = any>(p: string, body?: any) => request<T>(p, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T = any>(p: string) => request<T>(p, { method: 'DELETE' }),
};

/** Build an SSE URL carrying the token as a query param (EventSource can't set headers). */
export function streamUrl(runId: string) {
  return `${BASE}/api/runs/${runId}/stream?token=${encodeURIComponent(token || '')}`;
}
