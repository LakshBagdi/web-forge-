import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { wrap, HttpError } from '../middleware/error';
import {
  listWorkflows, getWorkflow, createWorkflow, updateWorkflow,
  duplicateWorkflow, deleteWorkflow, listVersions, getVersionGraph, saveVersion,
  getOrCreateWebhookToken, rotateWebhookToken,
} from '../services/workflows';
import { validateWorkflow } from '../engine/dag';

export const workflowRouter = Router();
workflowRouter.use(requireAuth);

const graphSchema = z.object({
  nodes: z.array(z.any()),
  edges: z.array(z.any()),
});

workflowRouter.get('/', wrap(async (req: AuthedRequest, res) => {
  res.json({ workflows: await listWorkflows(req.userId!) });
}));

workflowRouter.post('/', wrap(async (req: AuthedRequest, res) => {
  const body = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    graph: graphSchema.optional(),
  }).parse(req.body);
  const graph = body.graph ?? { nodes: [], edges: [] };
  const wf = await createWorkflow(req.userId!, body.name, body.description ?? '', graph);
  res.json({ workflow: wf });
}));

workflowRouter.get('/:id', wrap(async (req: AuthedRequest, res) => {
  const wf = await getWorkflow(req.userId!, req.params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  res.json({ workflow: wf, validation: validateWorkflow(wf.graph) });
}));

workflowRouter.put('/:id', wrap(async (req: AuthedRequest, res) => {
  const body = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    graph: graphSchema.optional(),
    newVersion: z.boolean().optional(),
    note: z.string().optional(),
  }).parse(req.body);
  const wf = await updateWorkflow(
    req.userId!, req.params.id,
    { name: body.name, description: body.description, graph: body.graph },
    body.newVersion ?? false, body.note ?? '',
  );
  if (!wf) throw new HttpError(404, 'Workflow not found');
  res.json({ workflow: wf, validation: body.graph ? validateWorkflow(body.graph) : [] });
}));

workflowRouter.post('/:id/duplicate', wrap(async (req: AuthedRequest, res) => {
  const wf = await duplicateWorkflow(req.userId!, req.params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  res.json({ workflow: wf });
}));

workflowRouter.delete('/:id', wrap(async (req: AuthedRequest, res) => {
  await deleteWorkflow(req.userId!, req.params.id);
  res.json({ ok: true });
}));

workflowRouter.get('/:id/webhook', wrap(async (req: AuthedRequest, res) => {
  const token = await getOrCreateWebhookToken(req.userId!, req.params.id);
  if (!token) throw new HttpError(404, 'Workflow not found');
  res.json({ token, path: `/hooks/${token}` });
}));

workflowRouter.post('/:id/webhook/rotate', wrap(async (req: AuthedRequest, res) => {
  const token = await rotateWebhookToken(req.userId!, req.params.id);
  if (!token) throw new HttpError(404, 'Workflow not found');
  res.json({ token, path: `/hooks/${token}` });
}));

workflowRouter.post('/:id/validate', wrap(async (req: AuthedRequest, res) => {
  const wf = await getWorkflow(req.userId!, req.params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const graph = req.body?.graph ?? wf.graph;
  res.json({ validation: validateWorkflow(graph) });
}));

// --- versions ---
workflowRouter.get('/:id/versions', wrap(async (req: AuthedRequest, res) => {
  const wf = await getWorkflow(req.userId!, req.params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  res.json({ versions: await listVersions(req.params.id) });
}));

workflowRouter.post('/:id/versions', wrap(async (req: AuthedRequest, res) => {
  const wf = await getWorkflow(req.userId!, req.params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const note = typeof req.body?.note === 'string' ? req.body.note : '';
  const v = await saveVersion(req.params.id, wf.graph, note || 'Manual snapshot');
  res.json({ version: v });
}));

workflowRouter.post('/:id/versions/:version/restore', wrap(async (req: AuthedRequest, res) => {
  const wf = await getWorkflow(req.userId!, req.params.id);
  if (!wf) throw new HttpError(404, 'Workflow not found');
  const graph = await getVersionGraph(req.params.id, Number(req.params.version));
  if (!graph) throw new HttpError(404, 'Version not found');
  const updated = await updateWorkflow(req.userId!, req.params.id, { graph }, true, `Restored v${req.params.version}`);
  res.json({ workflow: updated });
}));
