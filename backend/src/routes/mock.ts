import { Router } from 'express';

/**
 * Bundled mock API so demo workflows run fully offline (no external services,
 * no network dependency during judging). Workflows call these localhost routes,
 * which the EGRESS_ALLOWLIST permits in dev.
 */
export const mockRouter = Router();

mockRouter.get('/users/:id', (req, res) => {
  res.json({ id: Number(req.params.id), name: `User ${req.params.id}`, tier: Number(req.params.id) % 2 ? 'pro' : 'free' });
});

mockRouter.post('/orders', (req, res) => {
  const amount = Number(req.body?.amount ?? 0);
  res.json({ orderId: Math.floor(Math.random() * 100000), amount, status: amount > 0 ? 'created' : 'rejected' });
});

mockRouter.get('/weather', (req, res) => {
  const city = String(req.query.city || 'Bhopal');
  res.json({ city, tempC: 20 + Math.floor(Math.random() * 15), condition: 'clear' });
});

// Fails a configurable number of times before succeeding — demonstrates retries.
const flaky = new Map<string, number>();
mockRouter.get('/flaky', (req, res) => {
  const key = String(req.query.key || 'default');
  const failTimes = Number(req.query.failTimes ?? 2);
  const count = (flaky.get(key) ?? 0) + 1;
  flaky.set(key, count);
  if (count <= failTimes) return res.status(503).json({ error: 'Temporarily unavailable', attempt: count });
  flaky.delete(key);
  res.json({ ok: true, succeededOnAttempt: count });
});

// Pretends to be a service with a rate limit: answers 429 "slow down" (with Retry-After: 1) the first `limitTimes` calls, then works.
const limited = new Map<string, number>();
mockRouter.get('/rate-limited', (req, res) => {
  const key = String(req.query.key || 'default');
  const limitTimes = Number(req.query.limitTimes ?? 1);
  const count = (limited.get(key) ?? 0) + 1;
  limited.set(key, count);
  if (count <= limitTimes) { res.set('Retry-After', '1'); return res.status(429).json({ error: 'Too many requests', attempt: count }); }
  limited.delete(key);
  res.json({ ok: true, succeededOnCall: count });
});

// Always 500 — demonstrates failure handling and the retry-from-failed feature.
// Slow endpoint (capped at 20s): demonstrates per-step timeouts and run cancellation.
mockRouter.get('/slow', (req, res) => {
  const ms = Math.min(20000, Math.max(0, Number(req.query.ms) || 1000));
  setTimeout(() => res.json({ slept: ms }), ms);
});

mockRouter.get('/always-fail', (_req, res) => res.status(500).json({ error: 'Intentional failure' }));

mockRouter.post('/notify', (req, res) => res.json({ delivered: true, echo: req.body ?? null }));

// ---- Offline stand-ins for real services, so triggers/OAuth/Meet flows can be demoed and tested ----

// A "channel" whose latest video id changes when something is published (YouTube/RSS stand-in).
const channels = new Map<string, number>();
mockRouter.get('/latest-video', (req, res) => {
  const ch = String(req.query.channel || 'demo');
  const n = channels.get(ch) ?? 1;
  res.json({ channel: ch, id: `vid${n}`, title: `Video #${n} from ${ch}`, url: `https://youtube.example/watch?v=vid${n}` });
});
mockRouter.post('/latest-video/publish', (req, res) => {
  const ch = String(req.query.channel || 'demo');
  channels.set(ch, (channels.get(ch) ?? 1) + 1);
  res.json({ ok: true, channel: ch, latest: `vid${channels.get(ch)}` });
});

// OAuth2 token endpoint: exchanges refresh token "good-refresh" for a short-lived access token.
// ?rotate=1 on the token URL makes it hand back a NEW refresh token (like X/Twitter does).
const retiredTokens = new Set<string>();
mockRouter.post('/oauth/token', (req, res) => {
  const b = req.body || {};
  const basic = (req.headers.authorization || '').startsWith('Basic ');
  if (b.grant_type !== 'refresh_token') return res.status(400).json({ error: 'unsupported_grant_type' });
  const rt = String(b.refresh_token);
  const valid = (rt === 'good-refresh' || rt.startsWith('rt-')) && !retiredTokens.has(rt);
  if (!valid) return res.status(400).json({ error: 'invalid_grant' });
  if (!basic && b.client_id !== 'mock-client') return res.status(401).json({ error: 'invalid_client' });
  const out: any = { access_token: `at-${Date.now()}`, expires_in: 3600, token_type: 'Bearer' };
  if (req.query.rotate === '1' && rt.startsWith('rt-')) { retiredTokens.add(rt); out.refresh_token = rt + '+'; } // old one dies, like X
  res.json(out);
});

// Google Calendar stand-in: creating an event with conferenceData returns a Meet link.
mockRouter.post('/calendar/events', (req, res) => {
  // No auth header: allowed (so the starter template works offline). With one, it must be a token from /mock/oauth/token.
  const auth = String(req.headers.authorization || '');
  if (auth && !auth.startsWith('Bearer at-')) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const id = Math.random().toString(36).slice(2, 8);
  res.json({
    id, summary: b.summary ?? '(no title)', start: b.start, end: b.end,
    hangoutLink: b.conferenceData ? `https://meet.google.com/mock-${id}` : undefined,
    status: 'confirmed',
  });
});

// Generic bearer-protected endpoint for credential demos.
mockRouter.get('/protected', (req, res) => {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing bearer token' });
  res.json({ ok: true, tokenPrefix: auth.slice(7, 10) });
});

// Same JSON shape as YouTube Data API v3 playlistItems, so the real templates can be tested offline.
mockRouter.get('/youtube/playlistItems', (req, res) => {
  if (!req.query.key) return res.status(403).json({ error: { message: 'API key not valid' } });
  const ch = String(req.query.playlistId || 'UUdemo');
  const n = channels.get(ch) ?? 1;
  res.json({ items: [{ snippet: { title: `Video #${n} from ${ch}`, resourceId: { kind: 'youtube#video', videoId: `vid${n}` } } }] });
});
