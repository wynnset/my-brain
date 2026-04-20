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
│   │   ├── migrate/         # Multi-user startup: normalise volume → users/<id>/…
│   │   └── dashboard/       # `workspace/dashboard.json` manifest (pages, nav, SQL)
│   ├── public/              # Static assets (Express `static` root after auth)
│   │   ├── dashboard.html   # SPA shell (Tailwind CDN, hash routing)
│   │   ├── login.html
│   │   ├── dashboard.css , favicon.svg
│   │   ├── js/              # Dashboard client (ES modules)
│   │   └── shared/          # Small modules also imported by Node (e.g. stream chunk joiner)
│   ├── chat-sdk-runner.mjs  # Agent SDK runner (ESM); loaded when `BRAIN_CHAT_BACKEND=sdk`
│   ├── mcp-brain-db.mjs     # stdio MCP server: read-only `SELECT` on tenant DB files
│   └── package.json
├── data/                    # Default DB dir: single-tenant `*.db` files and multi-user volume root
├── docker-seed/             # Files for Fly images / init (e.g. `brain.sql`, `registry.sql`)
├── tenant-defaults/         # Neutral stubs for new tenants (`CYRUS.md`, `config.json`, `team/`, …)
├── team/                    # Agent definitions (one `.md` per agent)
├── team-inbox/ , owners-inbox/ , docs/   # Workspace content (single-tenant or per-tenant copy)
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

Optional **repo-root `.env`** (same level as `CYRUS.md`): loaded on startup. See **`.env.example`**. Common keys: `ANTHROPIC_API_KEY`, `BRAIN_CHAT_BACKEND`, `PORT`, `DATA_DIR`, `DB_DIR`, `BRAIN_MULTI_USER`, `SESSION_SECRET`, `DASHBOARD_PASSWORD`.

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
         SQLite under DB_DIR (single-tenant) or users/<uuid>/data/ (multi-user)
```

**Main JSON endpoints:** `/api/health`, `/api/auth-status`, `/api/login`, `/api/logout`, `/api/dashboard`, `/api/dashboard-manifest`, `/api/dashboard-page/:slug`, `/api/dashboard-section/...`, `/api/dashboard-section-todos/...`, `/api/dashboard-section-view/...`, `/api/career`, `/api/finance`, `/api/business`, `/api/action-domain/:slug`, `/api/action-items/:id`, `/api/files`, `/api/upload`, `/api/chat`, `/api/db`, orchestrator brief routes (`/api/cyrus`, …).

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

Multi-user tenants with **no** `dashboard.json` start with **no** default domain pages (Home + Files only) until they add `pages` or copy an example from **`tenant-defaults/dashboard.example.json`**.

### Dashboard pages (built-in templates)

When **`workspace/dashboard.json` is omitted** (single-tenant only), the app ships default **Career**, **Finance**, and **Business** tabs as **`template: "sections"`** pages: each tab runs the same read-only SQL (against `brain`, `launchpad`, `finance`, and/or `wynnset` DB files) that previously powered the legacy JSON APIs—composed sections, sortable/filterable tables in the browser, no per-domain server edits.

| Area | Data | Purpose |
|------|------|---------|
| **Home** | `brain.db` + optional `launchpad.db` | All-domain action items, summary cards, active week |
| **Career** | `brain.db` + `launchpad.db` | Sections: actions, pipeline, applications, goals, outreach, consulting |
| **Finance** | `brain.db` + `finance.db` + `wynnset.db` | Sections: actions, burn, categories, accounts, compliance, trial balance, … |
| **Business** | `brain.db` + `wynnset.db` | Sections: actions, compliance, ledger, chart of accounts |

**`action_domain`** pages (declared in `dashboard.json`) reuse the same action-item list behaviour as the domains above, scoped to one `domain` value and **`brain.db`** only.

### Client UX (brief)

- Action lists: sort (date / urgency), group (domain / category), due-date range filters.
- Dark mode: Auto → Light → Dark; stored in `localStorage`.

---

## Dashboard chat

`POST /api/chat` streams **Server-Sent Events** (`text/event-stream`): JSON lines with `text`, `tool`, `heartbeat`, or terminal `[DONE]`.

| `BRAIN_CHAT_BACKEND` | Behaviour |
|----------------------|-----------|
| **`cli`** (default) | Spawns Claude Code: `claude -p --dangerously-skip-permissions`, `cwd` = workspace dir. |
| **`sdk`** | Loads `app/chat-sdk-runner.mjs` and runs the Agent SDK in-process; optional resume via `agentSdkSessionId` stored in the session JSON file. |

**Auth for the model:** same rules as Claude Code locally — Console **API key** in `.env` and/or **subscription** OAuth under `~/.claude` when no key is set. On **Fly.io**, use an API key or cloud-provider env (`CLAUDE_CODE_USE_BEDROCK`, etc.); the app may isolate `HOME` / config dirs so volume state does not override billing.

**Useful env (chat):**

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Normalises and passes through to the child; may drop `ANTHROPIC_AUTH_TOKEN` unless `BRAIN_CHAT_KEEP_ANTHROPIC_AUTH_TOKEN=1`. |
| `CLAUDE_CODE_EXECUTABLE` / `CLAUDE_BIN` | Path to `claude` binary (CLI backend and SDK). |
| `BRAIN_CHAT_TOOLS`, `BRAIN_CHAT_ALLOWED_TOOLS`, `BRAIN_CHAT_PERMISSION_MODE` | SDK tool policy. |
| `BRAIN_CHAT_MCP_DB=1` | Attach read-only DB MCP (`brain_select`). |
| `BRAIN_CHAT_MAX_TURNS` | SDK turn limit (default 100). |
| `BRAIN_CHAT_RESUME` | Set `0` to disable SDK session resume. |

Plan mode (checklist / execute) requires **`BRAIN_CHAT_BACKEND=sdk`**.

---

## Multi-user mode (`BRAIN_MULTI_USER=1`)

- **Volume root:** `TENANT_VOLUME_ROOT` or `DB_DIR` (if unset, defaults to repo **`data/`**, same basis as `server.js`’s `DB_DIR`). Holds **`registry.db`** and **`users/<uuid>/`** trees.
- **Per user:** `users/<uuid>/workspace/` (files, `team/`, inbox folders, `dashboard.json`) and `users/<uuid>/data/` (SQLite files, `chat-sessions/`, optional `chat-tool-audit.log`).
- **Auth:** `SESSION_SECRET` (32+ chars). Login + password; bcrypt in `registry.db`. Session cookie carries user id; the server resolves paths from that, never from unchecked client input.
- **Provisioning:** `node scripts/brain-add-user.cjs` (see script header for flags). New tenants get starter workspace files from **`tenant-defaults/`** and a **`brain.db`** seed from configured seed dirs / **`docker-seed/`** as documented in the script.
- **Machine API:** optional per-user `api_token` in `registry`; send `Authorization: Bearer <token>` for `POST /api/db` and `POST /api/upload` without a browser cookie.

Single-tenant mode: leave **`BRAIN_MULTI_USER` unset**, put the four `*.db` files under `DB_DIR`, set **`DASHBOARD_PASSWORD`** (or rely on open local use).

---

## Fly.io (short)

1. Build/deploy from repo **`Dockerfile`** (installs app deps + global `claude-code`, copies `app/server.js`, `app/server/`, `app/public/`, `chat-sdk-runner.mjs`, `mcp-brain-db.mjs`, seeds, `tenant-defaults/`).
2. Mount persistent volume at **`/data`**; set **`DATA_DIR`** / **`DB_DIR`** to `/data` in production.
3. **`fly secrets set`:** at minimum `ANTHROPIC_API_KEY` for chat; `SESSION_SECRET` + multi-user **or** `DASHBOARD_PASSWORD` for single-tenant; optional `BRAIN_API_TOKEN` for scripted `POST /api/db`.
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
- **Tests:** from **`app/`**, `npm test` runs `node --test` on `server/tenancy/`, `server/migrate/`, and `server/dashboard/` `*.test.js` files.
- **Tenant maintenance:** `scripts/brain-delete-user.cjs` loads tenancy helpers from **`app/server/tenancy/`**.
