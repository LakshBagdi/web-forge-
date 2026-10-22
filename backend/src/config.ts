import 'dotenv/config';
import crypto from 'node:crypto';

function bool(v: string | undefined, d = false) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function int(v: string | undefined, d: number) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
}
function list(v: string | undefined) {
  return (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const isProd = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET || '';
if (isProd && jwtSecret.length < 24) {
  throw new Error('JWT_SECRET must be a long random value in production');
}

/** Derive a 32-byte key from CREDENTIAL_KEY (accepts base64, hex, or raw passphrase). */
function credentialKey(): Buffer {
  const raw = process.env.CREDENTIAL_KEY || '';
  if (!raw) {
    if (isProd) throw new Error('CREDENTIAL_KEY must be set in production');
    // Deterministic dev key so restarts can still decrypt dev data. Never used in prod.
    return crypto.createHash('sha256').update('flowforge-dev-key').digest();
  }
  for (const enc of ['base64', 'hex'] as const) {
    try {
      const b = Buffer.from(raw, enc);
      if (b.length === 32) return b;
    } catch { /* try next */ }
  }
  // Fall back to hashing an arbitrary passphrase to 32 bytes.
  return crypto.createHash('sha256').update(raw).digest();
}

export const config = {
  port: int(process.env.PORT, 4000),
  isProd,
  databaseUrl: process.env.DATABASE_URL || 'postgres://vs:vs@localhost:5432/flowforge',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: jwtSecret || 'dev-only-insecure-secret',
  corsOrigins: list(process.env.CORS_ORIGINS),
  credentialKey: credentialKey(),
  // Hard-off in production regardless of env value, so a slip can't open SSRF.
  allowPrivateEgress: !isProd && bool(process.env.ALLOW_PRIVATE_EGRESS),
  // Dev default: allow the bundled mock API so demos work without a .env. Production default stays empty.
  egressAllowlist: list(process.env.EGRESS_ALLOWLIST ?? (isProd ? '' : `localhost:${int(process.env.PORT, 4000)},127.0.0.1:${int(process.env.PORT, 4000)}`)),
  maxStepsPerRun: int(process.env.MAX_STEPS_PER_RUN, 100),
  stepTimeoutMs: int(process.env.STEP_TIMEOUT_MS, 15_000),
  maxHttpResponseBytes: int(process.env.MAX_HTTP_RESPONSE_BYTES, 1024 * 1024),
  runConcurrency: int(process.env.RUN_CONCURRENCY, 5),
};
