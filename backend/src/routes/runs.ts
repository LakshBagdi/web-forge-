import { Router } from 'express';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { wrap, HttpError } from '../middleware/error';
import { createRun, retryRun, listRuns } from '../services/runs';
import { getRun, listLogs, setRunStatus } from '../services/runStore';
import { getWorkflow } from '../services/workflows';
import { validateWorkflow, hasErrors } from '../engine/dag';
import { bus, RunEvent } from '../events';

export const runRouter = Router();

// SSE stream must authenticate via ?token= (EventSource can't set headers).
runRouter.get('/:id/stream', requireAuth, wrap(async (req: AuthedRequest, res) => {
  const run = await getRun(req.params.id);
  if (!run || run.user_id !== req.userId) throw new HttpError(404, 'Run not found');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify({ run })}\n\n`);

  const send = (e: RunEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
  const listener = (e: RunEvent) => send(e);
  bus.on(req.params.id, listener);

  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  // If the run is already finished, close shortly after sending the snapshot.
  if (['success', 'failed', 'cancelled'].includes(run.status)) {
    setTimeout(() => { res.write('event: done\ndata: {}\n\n'); res.end(); }, 200);
  }
  req.on('close', () => { clearInterval(ping); bus.off(req.params.id, listener); });
}));

runRouter.use(requireAuth);

// Trigger a run of a workflow (validates first).
runRouter.post('/workflow/:workflowId', wrap(async (req: AuthedRequest, res) => {
  const wf = await getWorkflow(req.userId!, req.params.workflowId);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const issues = validateWorkflow(wf.graph);
  if (hasErrors(issues)) throw new HttpError(400, 'Workflow has validation errors; fix them before running');
  const run = await createRun(req.userId!, req.params.workflowId, { input: req.body?.input ?? {} });
  res.json({ run });
}));

runRouter.get('/', wrap(async (req: AuthedRequest, res) => {
  const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;
  res.json({ runs: await listRuns(req.userId!, workflowId) });
}));

runRouter.get('/:id', wrap(async (req: AuthedRequest, res) => {
  const run = await getRun(req.params.id);
  if (!run || run.user_id !== req.userId) throw new HttpError(404, 'Run not found');
  res.json({ run });
}));

runRouter.get('/:id/logs', wrap(async (req: AuthedRequest, res) => {
  const run = await getRun(req.params.id);
  if (!run || run.user_id !== req.userId) throw new HttpError(404, 'Run not found');
  const after = Number(req.query.after) || 0;
  res.json({ logs: await listLogs(req.params.id, after) });
}));

runRouter.post('/:id/retry', wrap(async (req: AuthedRequest, res) => {
  const run = await retryRun(req.userId!, req.params.id);
  if (!run) throw new HttpError(404, 'Run not found');
  res.json({ run });
}));

runRouter.post('/:id/cancel', wrap(async (req: AuthedRequest, res) => {
  const run = await getRun(req.params.id);
  if (!run || run.user_id !== req.userId) throw new HttpError(404, 'Run not found');
  if (['queued', 'running'].includes(run.status)) await setRunStatus(req.params.id, 'cancelled');
  res.json({ ok: true });
}));
