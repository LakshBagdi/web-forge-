import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { wrap, HttpError } from '../middleware/error';
import { listSchedules, createSchedule, deleteSchedule } from '../services/schedules';
import { getWorkflow } from '../services/workflows';

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth);

scheduleRouter.get('/workflow/:workflowId', wrap(async (req: AuthedRequest, res) => {
  res.json({ schedules: await listSchedules(req.userId!, req.params.workflowId) });
}));

scheduleRouter.post('/workflow/:workflowId', wrap(async (req: AuthedRequest, res) => {
  const body = z.object({
    cron: z.string().min(1).optional(),
    runAt: z.string().min(1).optional(),
    tz: z.string().min(1).optional(),
  }).parse(req.body);
  const wf = await getWorkflow(req.userId!, req.params.workflowId);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const schedule = await createSchedule(req.userId!, req.params.workflowId, body);
  res.json({ schedule });
}));

scheduleRouter.delete('/:id', wrap(async (req: AuthedRequest, res) => {
  await deleteSchedule(req.userId!, req.params.id);
  res.json({ ok: true });
}));
