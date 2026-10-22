# ⚡ FlowForge — Visual API Workflow Automation Platform

> Web Forge 2026 · Zenith MANIT · Online hackathon **PS 04 — FlowForge**

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

## 🚀 Local setup (2 commands)

Prereqs: Node 18+, Postgres and Redis running (Linux/WSL: `sudo service postgresql start` and `sudo service redis-server start`).

```bash
npm run setup     # once: installs packages, creates backend/.env (if missing), checks Postgres + Redis
npm run dev       # every time: starts backend (:4000) and frontend (:5173) together; Ctrl+C stops both
```

Then open http://localhost:5173. Both commands explain in plain words how to fix anything that is missing
(wrong Postgres password, Redis not running, port already in use).

First-time Postgres login (only if `npm run setup` says it is needed):

```bash
sudo -u postgres psql -c "CREATE USER vs WITH PASSWORD 'vs' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE flowforge OWNER vs;"
```

Manual start (two terminals) still works: `cd backend && npm run dev` and `cd frontend && npm run dev`.

The backend ships a **mock API** at `/mock/*` so demo workflows run with no
external services. In dev, `EGRESS_ALLOWLIST` permits localhost so workflows can
call it.

---

## 🔌 Triggers & connecting real services

A workflow can start in four ways, and talk to **any** service that has an HTTP API (Twitter/X, YouTube, Google Calendar/Meet, Slack, Discord, Stripe, your own code…).

| Start it with | How |
|---|---|
| **Manual** | ▶ Run (optionally with `{ } Input` JSON) |
| **Repeating schedule** | ⏰ Schedule → Repeat. Cron + **time zone** (e.g. `0 9 * * *` in `Asia/Kolkata`) |
| **One time, at an exact moment** | ⏰ Schedule → Run once (date + time). Fires once, even across restarts |
| **Webhook** | Click the Start node → copy the secret URL. Any app can `POST` JSON to `/hooks/<token>`; fields become `{{input.field}}` |
| **"When something changes"** | Add a **Watch for change** node after an HTTP call (e.g. latest video id) + a repeating schedule. The green branch runs only when the value differs from last time |

**Logging in to Google / YouTube / X** — Credentials → type `oauth2`: token URL, client id/secret and a *refresh token*. FlowForge swaps it for a fresh access token on every run (and stores rotated refresh tokens), so it never expires on you. Plain API keys/bearer tokens still work.

`{{now.iso}}`, `{{now.in30min}}`, `{{now.in1h}}`, `{{now.date}}` give the run's start time (handy for "meeting in 30 minutes").

The Workflows page has **ready-made templates**:

- **Real services** (paste your keys into the one `⚙ Settings` node, Save, Run): *New YouTube video → Discord*, *New YouTube video → post on X*, *Create a real Google Meet (at a set time)*, *Post a tweet on X*, *Webhook → Discord message*. A workflow that still contains a `PASTE_...` placeholder refuses to run, so nothing half-configured can fire.
- **Instant demos** (run offline against built-in demo endpoints): Meet at a set time, new video → post, webhook → alert.

API keys and webhook secrets in URLs are masked in run logs. To get an X refresh token run `node scripts/x-get-refresh-token.mjs` (see the file header).

## 🧑‍💻 No JSON needed

- **✉ Message mode** – on any POST/PUT/PATCH step just type your message; pick *Discord / Slack / X / Other* and FlowForge builds the JSON for you (live preview shown). Buttons insert **@everyone**, **@here**, **@channel**, tag a person (`<@USERID>`) or a role (`<@&ROLEID>`), or any data from earlier steps. **☰ Fields** = rows of name/value. **{ } Custom JSON** is still there for power users.
- **Quick setup** presets fill method + URL + body for Discord, Slack, X, YouTube, Google Meet or any GET/POST.
- **Method help** – choosing GET/POST/PUT/PATCH/DELETE explains it and shows/hides the body automatically. **Query parameters** and **Headers** have examples and "what is this?" help.
- **🧪 Test this step** runs just that step (non-GET asks to confirm) and shows what came back.
- **Delay** takes seconds/minutes (max 2 min per step – use ⏰ *Run once* for longer waits).
- **▶ Run vs ⏰ Schedule** – Run = now, once. A schedule never runs at creation; the panel shows the *Next run*, and History labels each run *You pressed Run / Scheduled / Webhook*.
- Side bars scroll, drag to resize (double-click resets) and collapse; sizes are remembered.

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
Built in a 12-hour sprint for Zenith MANIT Bhopal. online competition 2026 ORZ ORZ  
