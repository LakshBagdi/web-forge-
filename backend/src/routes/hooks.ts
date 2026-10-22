import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { wrap, HttpError } from '../middleware/error';
import { findByWebhookToken } from '../services/workflows';
import { createRun } from '../services/runs';
import { validateWorkflow, hasErrors } from '../engine/dag';

/**
 * Public webhook trigger. The unguessable token in the URL IS the credential, so there is no login:
 * any service (GitHub, Stripe, Zapier, a cron job, curl) can POST here to start a run.
 * The request body becomes the run input, readable in the workflow as {{input.field}}.
 */
export const hooksRouter = Router();

// Stops token guessing: only FAILED requests (unknown token, errors) count against an IP, so a busy
// legitimate sender (GitHub, Stripe...) calling several of your URLs is never throttled by this one.
hooksRouter.use(rateLimit({ windowMs: 60_000, max: 30, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many failed webhook requests from this address, slow down' } }));

// Per-URL cap too, so one leaked/looping URL can't flood the queue (the IP cap above stops token guessing).
hooksRouter.use('/:token', rateLimit({
  windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `hook:${req.params.token}`,
  message: { error: 'Too many requests to this webhook (limit 60/minute)' },
}));

const isObj = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);

const handle = wrap(async (req: any, res: any) => {
  const wf = await findByWebhookToken(String(req.params.token));
  if (!wf) throw new HttpError(404, 'Unknown webhook');
  const issues = validateWorkflow(wf.graph);
  if (hasErrors(issues)) {
    throw new HttpError(422, `Workflow is not runnable: ${issues.find((i) => i.level === 'error')?.message}`);
  }
  const body = req.body;
  const empty = body === undefined || body === null || body === '' || (isObj(body) && Object.keys(body).length === 0);
  const input: Record<string, any> = isObj(body) ? { ...body } : empty ? {} : { body };
  if (input.query === undefined && Object.keys(req.query || {}).length) input.query = req.query;
  const run = await createRun(wf.user_id, wf.id, { trigger: 'webhook', input });
  res.status(202).json({ ok: true, runId: run!.id });
});

hooksRouter.post('/:token', handle);
hooksRouter.get('/:token', handle); // handy for simple pingers; query string becomes input.query
