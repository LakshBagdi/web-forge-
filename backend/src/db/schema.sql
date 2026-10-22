-- VulnSight schema (idempotent; applied on boot)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_guest      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS targets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin              TEXT NOT NULL,          -- normalized scheme://host[:port]
  host                TEXT NOT NULL,          -- hostname or IP (no port)
  port                INT  NOT NULL,
  label               TEXT,
  verification_token  TEXT NOT NULL,
  verification_method TEXT,                   -- file | dns | meta | lab
  verified_at         TIMESTAMPTZ,
  is_lab              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, origin)
);

CREATE TABLE IF NOT EXISTS scans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id        UUID NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'queued', -- queued|running|completed|failed|cancelled
  profile          TEXT NOT NULL DEFAULT 'standard',
  modules          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- per-module progress
  score            INT,
  grade            TEXT,
  summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_summary       JSONB,
  request_count    INT NOT NULL DEFAULT 0,
  error            TEXT,
  baseline_scan_id UUID REFERENCES scans(id) ON DELETE SET NULL,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scans_target_idx ON scans(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scans_user_idx ON scans(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id             UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  fingerprint         TEXT NOT NULL,
  check_id            TEXT NOT NULL,
  module              TEXT NOT NULL,
  title               TEXT NOT NULL,
  severity            TEXT NOT NULL,   -- critical|high|medium|low|info
  confidence          TEXT NOT NULL,   -- confirmed|likely|uncertain
  category            TEXT NOT NULL,
  cwe                 TEXT,
  owasp               TEXT,
  location            TEXT NOT NULL,
  description         TEXT NOT NULL,
  evidence            JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources             TEXT[] NOT NULL DEFAULT '{}',
  occurrences         INT NOT NULL DEFAULT 1,
  verification_status TEXT NOT NULL DEFAULT 'open', -- open|verified_fixed|still_present
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS findings_scan_idx ON findings(scan_id);

CREATE TABLE IF NOT EXISTS ai_explanations (
  cache_key   TEXT PRIMARY KEY,   -- fingerprint + evidence hash
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  content     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  subject    TEXT,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_log(user_id, created_at DESC);
