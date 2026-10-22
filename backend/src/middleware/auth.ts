import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthedRequest extends Request {
  userId?: string;
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  // Accept token from Authorization header or query (SSE can't set headers easily).
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ')
    ? header.slice(7)
    : typeof req.query.token === 'string'
      ? req.query.token
      : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { sub: string };
    req.userId = decoded.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
