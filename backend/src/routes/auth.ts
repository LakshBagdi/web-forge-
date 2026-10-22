import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one } from '../db';
import { signToken, requireAuth, AuthedRequest } from '../middleware/auth';
import { wrap, HttpError } from '../middleware/error';

export const authRouter = Router();

const credsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
});

authRouter.post(
  '/register',
  wrap(async (req, res) => {
    const { email, password, name } = credsSchema.parse(req.body);
    const existing = await one('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing) throw new HttpError(409, 'Email already registered');
    const hash = await bcrypt.hash(password, 10);
    const user = await one<{ id: string; email: string; name: string }>(
      'INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, email, name',
      [email.toLowerCase(), name || email.split('@')[0], hash],
    );
    res.json({ token: signToken(user!.id), user });
  }),
);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = credsSchema.parse(req.body);
    const user = await one<{ id: string; email: string; name: string; password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE email=$1',
      [email.toLowerCase()],
    );
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    res.json({ token: signToken(user.id), user: { id: user.id, email: user.email, name: user.name } });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req: AuthedRequest, res) => {
    const user = await one('SELECT id, email, name FROM users WHERE id=$1', [req.userId]);
    res.json({ user });
  }),
);
