-- FlowForge schema (idempotent; applied on boot)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  -- live editable graph: { nodes: [...], edges: [...] }
  graph           JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  active_version  INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflows_user_idx ON workflows(user_id, updated_at DESC);

-- Immutable snapshots. Every save bumps a version so runs are reproducible and restorable.
CREATE TABLE IF NOT EXISTS workflow_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  graph       JSONB NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,        -- bearer | basic | api_key | header
  -- AES-256-GCM: { iv, tag, data } base64. Secret values never stored in plaintext,
  -- never returned to the client.
  enc         JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version         INT NOT NULL,
  graph           JSONB NOT NULL,         -- snapshot actually executed
  status          TEXT NOT NULL DEFAULT 'queued', -- queued|running|success|failed|cancelled
  trigger         TEXT NOT NULL DEFAULT 'manual', -- manual|schedule|retry
  input           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- per-node state: { nodeId: { status, attempts, startedAt, finishedAt, output, error } }
  node_state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error           TEXT,
  parent_run_id   UUID REFERENCES runs(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_workflow_idx ON runs(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);

CREATE TABLE IF NOT EXISTS run_logs (
  id         BIGSERIAL PRIMARY KEY,
  run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id    TEXT,
  level      TEXT NOT NULL DEFAULT 'info', -- info|warn|error|debug
  message    TEXT NOT NULL,
  data       JSONB,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_logs_run_idx ON run_logs(run_id, id);

CREATE TABLE IF NOT EXISTS schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cron         TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
