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

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (opts.body) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  // Never wait forever: if the backend is down or stuck, fail with a clear message after 15 s.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { ...opts, headers, signal: ctrl.signal });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running (npm run dev in the backend folder, port 4000)?', 0);
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body, e.g. a proxy error page */ }
  if (!res.ok) {
    const proxyDown = res.status >= 500 && !data?.error;
    throw new ApiError(proxyDown ? 'The backend is not responding (is it running on port 4000?)' : (data?.error || `Request failed (${res.status})`), res.status);
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
