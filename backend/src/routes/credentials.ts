import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { wrap } from '../middleware/error';
import { createCredential, listCredentials, deleteCredential } from '../services/credentials';

export const credentialRouter = Router();
credentialRouter.use(requireAuth);

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(['bearer', 'basic', 'api_key', 'header', 'oauth2']),
  data: z.record(z.string(), z.string()),
});

credentialRouter.get('/', wrap(async (req: AuthedRequest, res) => {
  res.json({ credentials: await listCredentials(req.userId!) });
}));

credentialRouter.post('/', wrap(async (req: AuthedRequest, res) => {
  const body = schema.parse(req.body);
  const cred = await createCredential(req.userId!, body.name, body.type, body.data);
  res.json({ credential: cred });
}));

credentialRouter.delete('/:id', wrap(async (req: AuthedRequest, res) => {
  await deleteCredential(req.userId!, req.params.id);
  res.json({ ok: true });
}));
