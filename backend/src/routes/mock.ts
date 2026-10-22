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

// Always 500 — demonstrates failure handling and the retry-from-failed feature.
mockRouter.get('/always-fail', (_req, res) => res.status(500).json({ error: 'Intentional failure' }));

mockRouter.post('/notify', (req, res) => res.json({ delivered: true, echo: req.body ?? null }));
