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

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (opts.body) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
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
