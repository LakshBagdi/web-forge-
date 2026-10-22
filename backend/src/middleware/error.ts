import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
}

/** Wrap async route handlers so rejected promises reach the error handler. */
export function wrap(fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: any, res: Response, next: NextFunction) => fn(req, res, next).catch(next);
}
