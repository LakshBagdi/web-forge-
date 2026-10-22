import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { migrate } from './db';
import { startWorker } from './queue';
import { errorHandler, notFound } from './middleware/error';
import { authRouter } from './routes/auth';
import { workflowRouter } from './routes/workflows';
import { runRouter } from './routes/runs';
import { credentialRouter } from './routes/credentials';
import { scheduleRouter } from './routes/schedules';
import { mockRouter } from './routes/mock';
import { hooksRouter } from './routes/hooks';
import { oauthRouter } from './routes/oauth';
import { restoreSchedules } from './services/schedules';

// A stray failed promise must never take the whole server down.
process.on('unhandledRejection', (e: any) => console.error('[unhandledRejection]', e?.message || e));
process.on('uncaughtException', (e: any) => console.error('[uncaughtException]', e?.message || e));

async function main() {
  await migrate();
  startWorker();
  await restoreSchedules().catch((e) => console.warn('restoreSchedules failed:', e?.message));

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' })); // form posts (webhooks, OAuth mock)
  app.use(express.text({ type: 'text/*', limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Basic abuse protection on auth + run triggers.
  const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
  app.use('/api/auth', limiter, authRouter);
  app.use('/api/oauth', limiter, oauthRouter);
  app.use('/api/workflows', workflowRouter);
  app.use('/api/runs', runRouter);
  app.use('/api/credentials', credentialRouter);
  app.use('/api/schedules', scheduleRouter);
  app.use('/hooks', hooksRouter); // public, token-authenticated webhook triggers
  app.use('/mock', mockRouter); // demo-only target API

  // Single-service hosting: if the frontend has been built (frontend/dist), serve it from here too,
  // so one URL = website + API (same origin, no CORS setup). In local dev vite serves the website instead.
  const distCandidates = [process.env.FRONTEND_DIST, path.resolve(process.cwd(), '../frontend/dist'), path.resolve(process.cwd(), 'frontend/dist')].filter(Boolean) as string[];
  const dist = distCandidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (/^\/(api|hooks|mock|assets)(\/|$)/.test(req.path)) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
    console.log(`Serving the website from ${dist}`);
  }

  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`FlowForge API on :${config.port} (env=${config.isProd ? 'prod' : 'dev'})`);
  });

  // Free Redis can be wiped while we keep running: re-register every schedule from the database now and then (idempotent).
  setInterval(() => { restoreSchedules().catch((e) => console.warn('schedule re-sync failed:', e?.message)); }, 5 * 60_000).unref();

  // On Render, visit our own public address every 10 minutes so the free instance doesn't go to sleep (backup for the uptime pinger).
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl && process.env.KEEP_AWAKE !== '0') {
    setInterval(() => { fetch(`${selfUrl}/api/health`).catch(() => {}); }, 10 * 60_000).unref();
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
