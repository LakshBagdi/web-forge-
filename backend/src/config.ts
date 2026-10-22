import 'dotenv/config';

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
  throw new Error('JWT_SECRET must be set to a long random value in production');
}

export const config = {
  port: int(process.env.PORT, 4000),
  isProd,
  databaseUrl: process.env.DATABASE_URL || 'postgres://vs:vs@localhost:5432/vulnsight',
  jwtSecret: jwtSecret || 'dev-only-insecure-secret-change-me',
  corsOrigins: list(process.env.CORS_ORIGINS),
  labTargets: list(process.env.LAB_TARGETS),
  // Hard-disabled in production regardless of env, so a misconfiguration can't open SSRF.
  allowPrivateTargets: !isProd && bool(process.env.ALLOW_PRIVATE_TARGETS),
  scansPerHourPerUser: int(process.env.SCANS_PER_HOUR_PER_USER, 12),
  maxConcurrentScans: int(process.env.MAX_CONCURRENT_SCANS, 3),
  scanRequestBudget: int(process.env.SCAN_REQUEST_BUDGET, 300),
  scanTimeoutMs: int(process.env.SCAN_TIMEOUT_MS, 180_000),
  requestTimeoutMs: 8_000,
  maxBodyBytes: 512 * 1024,
  llm: {
    provider: (process.env.LLM_PROVIDER || 'gemini').toLowerCase() as 'gemini' | 'openai' | 'anthropic',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
  },
  zap: {
    url: (process.env.ZAP_API_URL || '').replace(/\/$/, ''),
    key: process.env.ZAP_API_KEY || '',
  },
  userAgent: 'VulnSight-Auditor/1.0 (+authorized-security-scan)',
};
