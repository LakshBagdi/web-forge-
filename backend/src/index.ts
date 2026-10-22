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
import { restoreSchedules } from './services/schedules';

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

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Basic abuse protection on auth + run triggers.
  const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
  app.use('/api/auth', limiter, authRouter);
  app.use('/api/workflows', workflowRouter);
  app.use('/api/runs', runRouter);
  app.use('/api/credentials', credentialRouter);
  app.use('/api/schedules', scheduleRouter);
  app.use('/mock', mockRouter); // demo-only target API

  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`FlowForge API on :${config.port} (env=${config.isProd ? 'prod' : 'dev'})`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
