# Cyrus — System Overview

Cyrus is a personal AI-powered command centre for career, finance, and business. It combines specialised AI agents (markdown specs under `team/`), four SQLite databases, and a local web dashboard served by a small Node.js app.

---

## Repository layout

```
my-brain/                    (directory name may differ)
├── CYRUS.md                 # Orchestrator brief for the agent team
├── app/                     # Dashboard web application
│   ├── server.js            # Express bootstrap: env, DB handles, middleware, route mount
│   ├── server/              # Node server code (not served to the browser)
│   │   ├── routes/          # HTTP handlers (chat SSE, files, dashboard JSON, auth, …)
│   │   ├── middleware/      # Session gate, tenant API token, dashboard DB readiness
│   │   ├── lib/             # Session cookies, orchestrator paths, SQLite helpers, …
│   │   ├── tenancy/         # Volume paths, registry DB helpers, per-tenant SQLite
│   │   └── dashboard/       # `workspace/dashboard.json` manifest (pages, nav, SQL)
│   ├── public/              # Static assets (Express `static` root after auth)
│   │   ├── dashboard.html   # SPA shell (Tailwind CDN, hash routing)
│   │   ├── login.html
│   │   ├── dashboard.css , favicon.svg
│   │   ├── js/              # Dashboard client (ES modules)
│   │   └── shared/          # Small modules also imported by Node (e.g. stream chunk joiner)
│   ├── chat-sdk-runner.mjs  # Agent SDK runner (ESM); the only chat backend
│   ├── mcp-brain-db.mjs     # stdio MCP server: read-only `SELECT` on tenant DB files
│   └── package.json
├── data/                    # Default volume root (registry.db + users/<uuid>/…)
├── docker-seed/             # Files for Fly images / init (e.g. `brain.sql`, `registry.sql`)
├── tenant-defaults/         # Neutral stubs for new tenants (`CYRUS.md`, `config.json`, `team/`, …)
└── docs/                    # This documentation
```

The server opens SQLite in **read-only** mode for dashboard queries. Writes go through controlled paths (`POST /api/db`, chat tools, PATCH action items, file uploads, orchestrator brief PUT, etc.). Only **`app/public/`** is exposed as static files after the session gate—not the whole `app/` tree.

---

## The four databases

### `brain.db` — cross-domain action ledger

Shared `action_items` table: tasks every dashboard page can show.

- **Domains:** `career`, `finance`, `business`, `personal`, `family`
- **Useful views:** `v_open_action_items`, `v_items_by_domain`, `v_overdue_items`

### `launchpad.db` — career tracker

Eight-week plan, applications, outreach, consulting, weekly goals, income-related views.

- **Useful views:** `v_pipeline`, `v_outreach_status`, `v_consulting_pipeline`, …

### `finance.db` — personal transaction ledger

Imports, categories, burn rate, income, account snapshots.

- Prefer views like **`v_real_spending`** over raw `transactions` where transfers would double-count.

### `wynnset.db` — corporate accounting

Chart of accounts, journal entries, compliance calendar, shareholder loan, trial balance views.

---

## AI agents

Agents live in `team/` as markdown. **`CYRUS.md`** describes orchestration and routing.

| Agent | Role | Primary DBs |
|-------|------|-------------|
| **Cyrus** | Orchestrator | Routes work; does not own tables |
| **Dash** | Pipeline / career ops | `brain.db`, `launchpad.db` |
| **Ledger** | Finance | `brain.db`, `finance.db` |
| **Charter** | Corporate accounting | `brain.db`, `wynnset.db` |
| **Scout**, **Relay**, **Debrief**, … | Research, outreach, interview prep, etc. | Mostly `launchpad.db` or file outputs |

Outputs often land in **`owners-inbox/`** as `.md` or other files.

---

## Dashboard application

### Run locally

```bash
cd app && npm install    # once
cd ..                    # repo root
node app/server.js       # default http://localhost:3131 (may auto-open browser)
```

Optional **repo-root `.env`** (same level as `CYRUS.md`): loaded on startup. See **`.env.example`**. Common keys: `ANTHROPIC_API_KEY`, `PORT`, `DATA_DIR`, `DB_DIR`, `SESSION_SECRET`, `TENANT_VOLUME_ROOT`. **`SESSION_SECRET`** (32+ chars) is required — the server refuses to start without it.

### Request flow (conceptual)

```
Browser  →  public/dashboard.html + public/js/*.mjs  (hash routes: #/, #/career, …)
              ↓ fetch JSON
         Express (app/server.js)
              ↓
         middleware: JSON body, optional Bearer → tenant, session cookie gate
              ↓
         server/routes/*.js  →  better-sqlite3 (read-only opens) + workspace file I/O
              ↓
         SQLite under users/<uuid>/data/ (per-tenant)
```

**Main JSON endpoints:** `/api/health`, `/api/auth-status`, `/api/login`, `/api/logout`, `/api/dashboard`, `/api/dashboard-manifest`, `/api/dashboard-page/:slug`, `/api/dashboard-section/...`, `/api/dashboard-section-todos/...`, `/api/dashboard-section-view/...`, `/api/career`, `/api/finance`, `/api/business`, `/api/action-domain/:slug`, `/api/action-items/:id`, `/api/files`, `/api/upload`, `/api/chat`, `/api/chat/limits`, `/api/chat/usage-summary`, `/api/chat/conversations`, `/api/chat/conversations/:id/stream`, `/api/chat/conversations/:id/abort`, `/api/db`, orchestrator brief routes (`/api/cyrus`, …).

### Dashboard manifest (`workspace/dashboard.json`)

The dashboard reads **`workspace/dashboard.json`** (see `app/server/dashboard/dashboard-manifest.js`). This file controls **which nav tabs exist** for that workspace. It is the right place for users to add pages **without** editing application server code.

| `template` | Purpose | Typical fields |
|------------|---------|----------------|
| **`career`**, **`finance`**, **`business`** | Legacy first-class dashboards backed by **`/api/career`** etc. (rich HTML). Still supported in custom manifests. Each needs its default SQLite file(s) on disk (`launchpad.db`, `finance.db`, `wynnset.db`) before the tab enables. | `slug`, `label`, optional `description` |
| **`sections`** | Stack **`todos`**, **`funnel_bars`**, **`progress_card`**, **`stat_cards`**, **`grouped_accordion`**, **`metric_datatable`**, **`account_cards`** (balance **card grid** from SQL — `name`, `account_type`, `owner`, `balance`, `snapshot_date`), **`link_groups`** (static link columns; optional **`db`** gating), and/or **`datatable`**. Aliases **`job_pipeline`** → `funnel_bars`, **`week_card`** → `progress_card` (launchpad defaults). Optional **`layout`**: `full` (default) or `half` / `condensed` / `narrow` for a two-column grid on medium+ screens. | `account_cards`: **`db`** + **`sql`**. `link_groups`: edit **`groups`** in **`dashboard.json`**. Section **`id`**s: lowercase letters, digits, hyphens. |
| **`action_domain`** | One nav tab listing **open** `action_items` for a single `brain.db` domain (same UX as the action list on Finance/Business). Use this for **`personal`** or **`family`** (or any allowed domain) **without** new server routes. | `slug`, `label`, **`domain`**: one of `career`, `finance`, `business`, `personal`, `family` (must match `action_items.domain`). Requires **`brain.db`**. |
| **`datatable`** | Read-only table from one tenant DB: one **`SELECT`**. | `slug`, `label`, **`db`** (basename), **`sql`** |

**Important distinctions for assistants:**

- **`action_items.domain`** in `brain.db` (e.g. `family`) is **data**, not a dashboard template name. You do **not** add a new template called `family` in JSON.
- To give the user a **Family** (or **Personal**) tab with filters, complete, and edit like other domain lists: add a page with `"template": "action_domain"` and `"domain": "family"` (or `"personal"`), with a unique **`slug`** (e.g. `family`).
- **`datatable`** / **`sections`** are for **SQL-driven** read-only views (any tenant `*.db`). Use **`action_domain`** when the goal is **interactive action items for one domain** (complete, edit, snooze) **without** writing SQL sections.
- Telling the user to edit **`app/server/routes/domain.js`**, **`dashboard-manifest.js`**, or **`dashboard.html`** to add a domain tab is **almost always wrong** unless they are explicitly extending the **product** with a new manifest template type.

**Example — `family` tab via manifest only:**

```json
{
  "version": 1,
  "pages": [
    {
      "slug": "family",
      "label": "Family",
      "description": "Family priorities and open tasks",
      "template": "action_domain",
      "domain": "family"
    }
  ]
}
```

New tenants with **no** `dashboard.json` start with **no** default domain pages (Home + Files only) until they add `pages` or copy an example from **`tenant-defaults/dashboard.example.json`**.

**`action_domain`** pages (declared in `dashboard.json`) provide a one-tab list of open action items scoped to a single `domain` value, backed by **`brain.db`**.

### Client UX (brief)

- Action lists: sort (date / urgency), group (domain / category), due-date range filters.
- Dark mode: Auto → Light → Dark; stored in `localStorage`.

---

## Dashboard chat

`POST /api/chat` streams **Server-Sent Events** (`text/event-stream`): JSON lines with `text`, `tool`, `heartbeat`, or terminal `[DONE]`.

### Concurrent chats and reattach

When **`BRAIN_CHAT_REGISTRY` is not `0`** (default: enabled), each in-flight assistant turn is registered in an in-process **chat run registry** keyed by conversation id:

- **`POST /api/chat`** still accepts the user message and returns the same SSE stream for the initiating tab. If a turn is already running for that conversation, the server responds **409** with `A response is still being generated for this chat.` (the dashboard queues another prompt for that chat until the run finishes).
- **`GET /api/chat/conversations/:id/stream?fromSeq=N`** attaches to the active run (or returns `noActiveRun` and `[DONE]` if nothing is running). Event payloads include a monotonic **`seq`** so late subscribers can pass **`fromSeq`** to replay buffered events. Multiple browser tabs can attach to the same run.
- **`POST /api/chat/conversations/:id/abort`** aborts the server-side run. The dashboard **Stop** button calls this so disconnecting one tab does not cancel a background run started from another tab.
- **`GET /api/chat/conversations`** and **`GET /api/chat/conversations/:id`** include **`active`** and **`lastEventSeq`** when the registry is enabled so the UI can show a spinner on running threads.

Set **`BRAIN_CHAT_REGISTRY=0`** to restore the legacy behaviour where closing the `POST /api/chat` response aborts the run.

The chat backend is the **Claude Agent SDK** (`app/chat-sdk-runner.mjs`), loaded in-process; optional resume via `agentSdkSessionId` stored in the session JSON file.

**Auth for the model:** same rules as Claude Code locally — Console **API key** in `.env` and/or **subscription** OAuth under `~/.claude` when no key is set. On **Fly.io**, use an API key or cloud-provider env (`CLAUDE_CODE_USE_BEDROCK`, etc.); the app may isolate `HOME` / config dirs so volume state does not override billing.

**Useful env (chat):**

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Normalises and passes through to the SDK; may drop `ANTHROPIC_AUTH_TOKEN` unless `BRAIN_CHAT_KEEP_ANTHROPIC_AUTH_TOKEN=1`. |
| `CLAUDE_CODE_EXECUTABLE` / `CLAUDE_BIN` | Path to `claude` binary used by the SDK. |
| `BRAIN_CHAT_TOOLS`, `BRAIN_CHAT_ALLOWED_TOOLS`, `BRAIN_CHAT_PERMISSION_MODE` | SDK tool policy. |
| `BRAIN_CHAT_MCP_DB=1` | Attach read-only DB MCP (`brain_select`). |
| `BRAIN_CHAT_MAX_TURNS` | SDK turn limit (default 100). |
| `BRAIN_CHAT_RESUME` | Set `0` to disable SDK session resume. |
| `BRAIN_CHAT_REGISTRY` | Set `0` to disable the in-process run registry (legacy: abort run when the POST stream closes). |
| `BRAIN_CHAT_RUN_MAX_MS` | Hard cap on run wall time in ms (default 30 minutes); aborts the run when exceeded. |
| `BRAIN_CHAT_RUN_EVENT_BUFFER` | Max buffered SSE events per run (default 5000); older events may be dropped with a `bufferTruncated` marker. |

---

## Multi-tenant layout

- **Volume root:** `TENANT_VOLUME_ROOT` or `DB_DIR` (if unset, defaults to repo **`data/`**, same basis as `server.js`’s `DB_DIR`). Holds **`registry.db`** and **`users/<uuid>/`** trees.
- **Per user:** `users/<uuid>/workspace/` (files, `team/`, inbox folders, `dashboard.json`) and `users/<uuid>/data/` (SQLite files, `chat-sessions/`, optional `chat-tool-audit.log`).
- **Auth:** `SESSION_SECRET` (32+ chars) is required. Login + password; bcrypt in `registry.db`. Session cookie carries user id; the server resolves paths from that, never from unchecked client input.
- **Provisioning:** `node scripts/brain-add-user.cjs` (see script header for flags). New tenants get starter workspace files from **`tenant-defaults/`** and a **`brain.db`** seed from configured seed dirs / **`docker-seed/`** as documented in the script.
- **Machine API:** optional per-user `api_token` in `registry`; send `Authorization: Bearer <token>` for `POST /api/db` and `POST /api/upload` without a browser cookie.

### Per-user chat credit limits

Every tenant has a **daily** and **monthly** USD cap on chat spend, enforced by
the server before `POST /api/chat` accepts a new message. Counters live in
`registry.db` (columns on `users` + `user_usage` table) so neither the dashboard
user nor the agents running on their behalf can edit them — the per-tenant
`data/` directory never sees this table.

- **Defaults:** `$10` daily / `$10` monthly, applied via column defaults when
  `registry.db` is initialised / migrated (`app/server/tenancy/registry-db.js`).
- **Daily reset:** UTC midnight. `day_key` rolls forward on the first request of
  the new day; the counter zeroes itself.
- **Monthly reset:** anchored to the user's account creation day-of-month
  (`users.created_at`). When a month does not contain that day (Feb 30/31, etc.)
  the cycle starts on that month's last day instead, so Jan 31 → Feb 28/29 → Mar 31.
- **Accounting:** after each assistant turn with billing data, the chat route
  calls `registryDb.addUsage(db, userId, totalCostUsd)`. The Agent SDK reports
  `totalCostUsd` per turn.
- **Enforcement:** `POST /api/chat` returns **`402 Payment Required`** with a
  JSON body `{ creditLimitExceeded: true, exceededKind: 'daily'|'monthly',
  resetsAt, dailyLimitUsd, monthlyLimitUsd, daySpendUsd, monthSpendUsd, … }`
  when a cap is hit. The dashboard shows a prominent red banner above the chat
  composer with the reset time and disables the Send button until the reset.
- **Read the snapshot:** `GET /api/chat/limits` returns the same payload for
  the authenticated tenant. The
  payload also carries a `monthHistory` array (newest cycle first, up to
  `BRAIN_CHAT_MONTH_HISTORY_LIMIT`, default `12`) of closed monthly cycles:
  `{ periodStart, periodEnd, spendUsd, closedAt }`.
- **Previous months:** closed monthly cycles are archived into
  `user_usage_history (user_id, period_start, period_end, spend_usd,
  closed_at)` inside the same transaction that zeroes the live counter in
  `ensureUsageRowAligned`. `period_end` is exclusive (equals the next cycle's
  start), so rendering "Apr 22 → May 22" requires no extra math. Daily
  rollovers are **not** archived (only the current day spend is kept, on
  `user_usage`).
- **Admin tooling:**
  - `node scripts/brain-add-user.cjs … [--daily-limit USD] [--monthly-limit USD]` sets limits at creation time.
  - `node scripts/brain-set-limits.cjs --login USER --daily-limit 25 --monthly-limit 250` updates an existing user.
  - `node scripts/brain-set-limits.cjs --list` prints every user's caps, current spend, and their 3 most recent closed months.
  - `node scripts/brain-set-limits.cjs --history USER_OR_UUID [--months N]` dumps every archived monthly cycle for one user.
  - A limit of `0` disables that cap.

---

## Fly.io (short)

1. Build/deploy from repo **`Dockerfile`** (installs app deps + global `claude-code`, copies `app/server.js`, `app/server/`, `app/public/`, `chat-sdk-runner.mjs`, `mcp-brain-db.mjs`, seeds, `tenant-defaults/`).
2. Mount persistent volume at **`/data`**; set **`DATA_DIR`** / **`DB_DIR`** to `/data` in production.
3. **`fly secrets set`:** at minimum `ANTHROPIC_API_KEY` for chat and `SESSION_SECRET` (32+ chars) for dashboard login. Per-user API tokens (for scripted `POST /api/db`) are stored on the `registry.db` `users.api_token` column — set via `brain-add-user.cjs --api-token …` or by editing the row.
4. Smoke: `curl https://<app>.fly.dev/api/health` → `{"ok":true,...}`.

---

## Extending the system

### New agent

1. Add `team/<name>.md`.
2. Register routing / hand-offs in `CYRUS.md`.
3. If it needs new tables: update the relevant `data/*.sql`, migrate the DB, then use the new tables from agents or API.

### New dashboard API behaviour

1. Add or change handlers under **`app/server/routes/`** (e.g. `dashboard.js`, `domain.js`, `chat.js`) and shared logic in **`app/server/lib/`** or **`app/server/dashboard/`**.
2. Wire **`app/server.js`** only if you need new bootstrap (new middleware or `ctx` fields passed into routes).

### New UI section

1. Extend **`app/public/dashboard.html`** and/or **`app/public/js/`** (entry: `dashboard-entry.mjs` → `dashboard-app.mjs`; shared helpers in `js/lib/`).
2. Point fetches at the right `/api/...` route.

### Schema change

1. Update the canonical **`.sql`** under `data/`.
2. Apply with `ALTER TABLE` / migration scripts as appropriate (avoid blindly re-running full schema against populated DBs).
3. Update SQL in route handlers or in **`workspace/dashboard.json`** datatable definitions if column names changed.

---

## Related paths

- **MCP (editors):** `app/mcp-brain-db.mjs` — read-only queries against the same DB files the dashboard uses.
- **Tests:** from **`app/`**, `npm test` runs `node --test` on `server/tenancy/` and `server/dashboard/` `*.test.js` files.
- **Tenant maintenance:** `scripts/brain-delete-user.cjs` loads tenancy helpers from **`app/server/tenancy/`**.
