# ⚡ FlowForge — Visual API Workflow Automation Platform

> Web Forge 2026 · Zenith MANIT · **PS 04 — FlowForge**

Build multi-step API workflows on a drag-and-drop canvas, then execute them on a
real backend engine with conditional branching, retries, timeouts, failure
recovery, live step-by-step logs, scheduling, and encrypted credentials.

Not a mock: the backend runs an actual **DAG execution engine** on a **BullMQ /
Redis** queue, persists every step's state to **Postgres**, and streams live
progress to the UI over **SSE**.

---

## ✨ Feature → Requirement map (PS 04)

| # | Requirement | How FlowForge does it |
|---|-------------|------------------------|
| 1 | Visual editor: API / condition / transform / delay / trigger nodes | React Flow canvas with 5 custom node types |
| 2 | Configure method, headers, auth, body, params | Full HTTP node inspector + credential picker |
| 3 | Directed graphs, branching, data passing | Topological DAG engine; `{{steps.x.output...}}` templating between steps |
| 4 | Manual **and** scheduled execution | Run button + cron schedules (BullMQ job scheduler) |
| 5 | Validate before running | Structural + per-node validation (cycles, orphans, missing config) with inline errors |
| 6 | Retries, timeouts, failure handling, **re-run failed steps** | Per-node exponential-backoff retries + timeouts; "retry from failed" reuses successful upstream steps |
| 7 | Live status, step logs, errors, history | SSE live node coloring + log stream; full run history |
| 8 | Save, edit, duplicate, **version** | Immutable version snapshots with restore; one-click duplicate |

### 🔒 Security constraint (explicitly required)
- **SSRF protection:** every outbound URL is resolved and each IP checked against
  private / loopback / link-local / **cloud-metadata (169.254.169.254)** / reserved
  ranges *before* connecting; the request is pinned to the validated IP to defeat
  DNS-rebinding.
- **Credential vault:** secrets encrypted at rest with **AES-256-GCM**, never
  returned to the browser, injected into requests only at execution time.
- Response-size caps, per-step timeouts, request limits, and rate limiting.

---

## 🧱 Architecture

```
React + Vite + TypeScript + React Flow        Node + Express + TypeScript
┌─────────────────────────────┐   HTTPS/SSE  ┌──────────────────────────────┐
│  Editor (canvas, inspector) │ ───────────▶ │  REST API + SSE stream       │
│  Live run view (SSE)        │ ◀─────────── │  Validation · Versions       │
└─────────────────────────────┘              │  DAG Executor ──┐            │
                                             │                 ▼            │
                                             │  BullMQ worker (Redis)       │
                                             │  SSRF guard · Cred vault     │
                                             └───────┬───────────┬──────────┘
                                                     ▼           ▼
                                                 Postgres      Redis
```

- **Engine** (`backend/src/engine`): `dag.ts` (topo sort, cycle detection,
  validation), `executor.ts` (run loop, retries, branch skipping, re-run),
  `nodes/` (node executors), `ssrfGuard.ts`, `httpClient.ts`, `expr.ts`
  (safe condition evaluator — no `eval`), `context.ts` (templating).
- **Queue** (`queue.ts`): BullMQ queue + worker + cron job scheduler.
- **Data** (`db/schema.sql`): users, workflows, workflow_versions, credentials,
  runs, run_logs, schedules.

---

## 🚀 Local setup

Prereqs: Node 20+, Postgres, Redis.

```bash
# 1. Backend
cd backend
cp .env.example .env            # set DATABASE_URL, REDIS_URL, JWT_SECRET, CREDENTIAL_KEY
npm install
npm run dev                     # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Generate a credential key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

The backend ships a **mock API** at `/mock/*` so demo workflows run with no
external services. In dev, `EGRESS_ALLOWLIST` permits localhost so workflows can
call it.

---

## 🧪 Tests

With the API running (`cd backend && npm run dev`):

```bash
cd backend
npm run test:api    # 32 end-to-end API checks: auth, tenant isolation, branching, retries,
                    # timeouts, cancel, cycles, schedules, versions, credentials, SSRF
npm run test:ssrf   # 28 IP-classification cases (IPv4, IPv6, IPv4-mapped/NAT64/6to4 tricks)
```

## 🎬 Demo script (2 min)

1. Register, click **“+ Sample workflow”** → a graph is pre-built: Trigger → HTTP
   (get user) → Condition (pro tier?) → notify / transform branches.
2. Hit **Run**. Watch nodes turn blue→green live, one branch taken, the other
   skipped, with a streaming log on the right.
3. Open the HTTP node, point it at `/mock/flaky?failTimes=2`, set **Max attempts
   = 4**, Run → watch it fail twice then succeed (retries).
4. Point a node at `/mock/always-fail`, Run → it fails; click **Retry from
   failed** → upstream successes are reused, only the failed step re-runs.
5. Show **Credentials** (encrypted, never returned) and **Save version** →
   restore.

---

## 🌐 Deploy

- **Backend → Render** (`render.yaml`): add a Postgres (Neon/Render) and Redis
  (Upstash/Render), paste `DATABASE_URL` / `REDIS_URL`, set `CREDENTIAL_KEY`,
  `JWT_SECRET`, and `CORS_ORIGINS` (your Vercel URL).
- **Frontend → Vercel**: root `frontend`, set `VITE_API_BASE` to the Render URL.
  `vercel.json` handles SPA routing.

---

## 👥 Squad — Web Forge 2026
Built in a 12-hour sprint for Zenith MANIT Bhopal. online competition
