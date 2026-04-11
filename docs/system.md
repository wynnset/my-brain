# Cyrus — System Overview

Cyrus is a personal AI-powered command centre for career, finance, and business management. It combines a team of specialised AI agents with a set of SQLite databases and a local web dashboard.

---

## Folder Structure

```
my-brain/   (repo directory name may differ)
├── CYRUS.md            # Cyrus brief: orchestrator of the AI team
├── app/                # Dashboard web app
│   ├── server.js           # Express server — reads all 4 DBs, exposes API
│   ├── chat-sdk-runner.mjs # Claude Agent SDK (ESM); loaded when BRAIN_CHAT_BACKEND=sdk
│   ├── mcp-brain-db.mjs    # stdio MCP server: read-only SELECT on the four DBs
│   ├── dashboard.html      # Single-file SPA (Tailwind, vanilla JS, hash routing)
│   └── package.json        # express, better-sqlite3, @anthropic-ai/claude-agent-sdk, zod, …
├── data/               # All databases and config
│   ├── config.json     # DB paths and global settings
│   ├── brain.db        # Cross-domain action items (shared ledger)
│   ├── launchpad.db    # Career tracker (8-week plan, applications, outreach)
│   ├── finance.db      # Personal & joint transaction ledger
│   ├── wynnset.db      # WynnSet Inc. corporate accounting
│   └── *.sql           # Schema files (source of truth for each DB)
├── team/               # AI agent definitions (one .md per agent)
├── team-inbox/         # Drop zone for raw files agents need to process
├── owners-inbox/       # Output directory — reports, briefs, resumes, analyses
└── docs/               # Documentation (you are here)
```

---

## The Four Databases

### `brain.db` — Cross-Domain Action Ledger
The single shared table (`action_items`) where all agents write tasks and todos that need Aidin's attention. Every page of the dashboard reads from this first.

- **Domains**: `career`, `finance`, `business`, `personal`, `family`
- **Key fields**: `urgency` (critical/high/medium/low), `due_date`, `status`, `snoozed_until`, `project_category`, `recurrence`
- **Key views**: `v_open_action_items`, `v_items_by_domain`, `v_overdue_items`
- **Who writes**: Any agent. Ledger writes finance items; Dash writes career items; Charter writes business items.

### `launchpad.db` — Career Tracker
Tracks the active 8-week career transition plan: job applications, networking outreach, consulting opportunities, weekly goals, and income.

- **Key tables**: `weeks`, `weekly_goals`, `companies`, `applications`, `contacts`, `outreach`, `consulting_leads`, `invoices`, `income`
- **Key views**: `v_pipeline`, `v_outreach_status`, `v_consulting_pipeline`, `v_income_summary`, `v_action_items`
- **Who writes**: Dash (primary writer). Scout adds companies/applications; Relay adds outreach.

### `finance.db` — Personal Transaction Ledger
All personal, joint, and business-tagged transactions imported from bank/credit card CSV exports. Used for burn rate, category breakdowns, income tracking, and net worth snapshots.

- **Key tables**: `accounts`, `transactions`, `categories`, `merchants`, `account_snapshots`
- **Key views**: `v_real_spending` (excludes transfers), `v_burn_rate_monthly`, `v_monthly_by_category`, `v_income_monthly`, `v_top_merchants`
- **Who writes**: Ledger agent processes CSV imports from `team-inbox/`.
- **Note**: Use `v_real_spending` not raw `transactions` to avoid double-counting credit card payments.

### `wynnset.db` — WynnSet Inc. Corporate Accounting
Double-entry bookkeeping for the corporation (CBCA #826229-2, FYE July 31). Tracks chart of accounts, journal entries, compliance calendar, shareholder loan, and dividends.

- **Key tables**: `accounts_coa`, `journal_entries`, `journal_lines`, `compliance_events`, `shareholder_loan`
- **Key views**: `v_trial_balance`, `v_compliance_upcoming`, `v_shareholder_loan_balance`
- **Who writes**: Charter agent.
- **Note**: GST unregistered until $30K CAD revenue threshold is crossed. Journal entries start empty — Charter populates them as transactions occur.

---

## The AI Agent Team

Agents are defined in `team/` as markdown files with role specs, tool access, and instructions. Cyrus (`CYRUS.md`) orchestrates.

| Agent | Role | Primary DB(s) |
|-------|------|---------------|
| **Cyrus** | Orchestrator / Chief of Staff | Routes tasks, never executes directly |
| **Dash** | Pipeline Manager | `brain.db`, `launchpad.db` |
| **Ledger** | Finance Analyst | `brain.db`, `finance.db` |
| **Charter** | Corporate Accountant | `brain.db`, `wynnset.db` |
| **Scout** | Job Research Analyst | `launchpad.db` |
| **Relay** | Outreach Drafter | `launchpad.db` |
| **Tailor** | Application Specialist | — (produces files) |
| **Scribe** | Content Writer | — (produces files) |
| **Debrief** | Interview Prep Coach | `launchpad.db` |
| **Vela** | Senior Designer | — (produces PDFs) |
| **Gauge** | Market Intelligence | — (research outputs) |
| **Arc** | Database Architect | All DBs (schema changes) |
| **Nolan** | HR Director | — (agent onboarding) |
| **Pax** | Senior Researcher | — (expertise profiles) |

Agent outputs go to `owners-inbox/` as `.md` or `.pdf` files.

---

## The Dashboard App

A lightweight Node.js + Express server that reads all 4 databases server-side and serves a single-page app.

### Running It

```bash
node app/server.js
# Opens http://localhost:3131 automatically
# Ctrl+C to stop
# PORT=3132 node app/server.js  (if 3131 is in use)
```

First-time setup (only needed once):
```bash
cd app && npm install
```

**Optional — avoid shell exports:** create a **`.env` file in the repo root** (same folder as `CYRUS.md`, not inside `app/`). The server loads it on startup via `dotenv`. Copy [`.env.example`](../.env.example) to `.env`. Set **`ANTHROPIC_API_KEY`** for Console API billing, *or* leave it unset and use **subscription auth** (see next subsection). Add **`BRAIN_CHAT_BACKEND=sdk`** when using the Agent SDK. `.env` is gitignored.

**Local: Claude subscription (Pro / Max) instead of `ANTHROPIC_API_KEY`**

1. **Remove** `ANTHROPIC_API_KEY` from `.env` (and from your shell) for this project if you want subscription billing. When an API key is set, [`app/server.js`](app/server.js) removes `ANTHROPIC_AUTH_TOKEN` from the chat child env so a stale bearer token does not override Console credits — that also means a key in `.env` blocks subscription token use.
2. Log in with **Claude Code on the same Mac** as the dashboard (run `claude` / complete the normal login or subscription flow). Credentials live under **`~/.claude`** (your real `HOME`). Run the dashboard **locally** with your normal user so that directory is visible to the spawned `claude` process.
3. Restart `node app/server.js`. You should see the log line that API key is unset and Claude Code may use OAuth/subscription auth — that is expected.

Advanced: if you intentionally need **both** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` passed through, set **`BRAIN_CHAT_KEEP_ANTHROPIC_AUTH_TOKEN=1`** (see `envForClaudeChat()` in `app/server.js`). Typical “subscription only” setups omit the API key instead.

**Fly.io:** the app sets `HOME` / `CLAUDE_CONFIG_DIR` under `/tmp` so volume state does not hijack billing; subscription tokens in a laptop `~/.claude` are **not** used on the server. Use **`fly secrets set ANTHROPIC_API_KEY=...`** (or Bedrock/Vertex envs) for production chat there.

If you installed `@anthropic-ai/claude-code` globally for **the same Node** you use to run the server, the binary is usually next to `node` (e.g. `.../node/v18.x.x/bin/claude`); the server auto-detects that path so you often do **not** need `CLAUDE_BIN` / `CLAUDE_CODE_EXECUTABLE` locally.

### Architecture

```
app/server.js              app/dashboard.html
    │                           │
    │  GET /api/dashboard        │  Hash routing: #/, #/career,
    │  GET /api/career           │  #/finance, #/business
    │  GET /api/finance          │
    │  GET /api/business         │  Tailwind CSS (CDN)
    │  GET /api/health           │  Vanilla JS — no build step
    │                           │
    └── better-sqlite3 ─────────┘
         │
         ├── brain.db (read-only)
         ├── launchpad.db (read-only)
         ├── finance.db (read-only)
         └── wynnset.db (read-only)
```

### Dashboard Pages

| Page | Primary Data Sources | What It Shows |
|------|---------------------|---------------|
| **Home** | `brain.db` + `launchpad.db` | All open action items (all domains), domain stat cards, active week |
| **Career** | `brain.db` + `launchpad.db` | Career actions, job pipeline, applications, week goals, outreach, consulting |
| **Finance** | `brain.db` + `finance.db` + `wynnset.db` | Finance actions, account balances, burn rate, income, merchants, compliance, shareholder loan |
| **Business** | `brain.db` + `wynnset.db` | Business actions, WynnSet stats, compliance calendar, chart of accounts |

### Action Items Controls (on every page)
- **Sort**: Date → Urgency (default) / Urgency → Date / Urgency only / Date only
- **Group**: None / By Domain (home) / By Category (other pages)
- **Range**: All / Overdue / Due today / This week / Next 2 weeks / No due date

### Dark Mode
Button in top-right cycles through: Auto (follows OS) → Light → Dark. Preference saved in `localStorage`. In Auto mode, updates live if OS setting changes.

### Dashboard chat (CLI vs Agent SDK)

`POST /api/chat` streams assistant text over SSE. Two backends:

| `BRAIN_CHAT_BACKEND` | Behavior |
|---------------------|----------|
| `cli` (default) | Spawns Claude Code (`claude -p --dangerously-skip-permissions`) with `cwd` = `DATA_DIR`. |
| `sdk` | Runs the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) in-process: same `cwd`, optional session resume (`agentSdkSessionId` in the chat session JSON). |

#### Agent SDK — what you need for it to work

The SDK is **not** a separate service: it is `npm` packages loaded by `app/server.js` (`@anthropic-ai/claude-agent-sdk`, `zod`) plus the **Claude Code** runtime the SDK drives internally. Locally you authenticate the same way as the CLI: **Console API key** and/or **Claude subscription** via Claude Code’s stored session (see “Claude subscription” above). On **Fly**, use an API key or cloud-provider env vars (`CLAUDE_CODE_USE_BEDROCK`, etc.); subscription-from-laptop does not apply there.

**1) Dependencies (local and in the Docker image)**  
From `app/`: run `npm install` so `node_modules` includes the SDK. The Fly image runs `npm install` during `docker build`; after changing `package.json`, **redeploy** so the image picks up new deps.

**2) Claude Code binary on `PATH`**  
The SDK expects to launch Claude Code like the CLI does. If `claude` is not found:

- **Local:** install globally, e.g. `npm install -g @anthropic-ai/claude-code`, then confirm `claude --version` in the same shell you use to start the server. If the binary lives elsewhere, set **`CLAUDE_CODE_EXECUTABLE`** to its full path.
- **Fly:** the `Dockerfile` already installs `@anthropic-ai/claude-code` globally. You normally do **not** need `CLAUDE_CODE_EXECUTABLE` unless the SDK errors about a missing executable (then set it to the real path inside the container, often under `/usr/local/bin`).

**3) Turn the SDK on**  
Set **`BRAIN_CHAT_BACKEND=sdk`**. If unset or `cli`, the old subprocess path is used.

**4) Auth**  
Locally: set **`ANTHROPIC_API_KEY`** in `.env` *or* rely on **subscription login** via Claude Code (no key in `.env`). On Fly: set **`ANTHROPIC_API_KEY`** (or bearer / OAuth / Bedrock / Vertex per `claudeAuthConfiguredOnFly()` in `app/server.js`). Chat returns 503 on Fly if nothing in that gate is configured.

---

**Local checklist (`BRAIN_CHAT_BACKEND=sdk`)**

1. `cd app && npm install`
2. Install Claude Code globally **or** set `CLAUDE_CODE_EXECUTABLE` to the `claude` binary.
3. Auth: `export ANTHROPIC_API_KEY="sk-ant-..."` **or** omit it and use subscription (see “Claude subscription” above).  
   Optional: `export BRAIN_CHAT_KEEP_ANTHROPIC_AUTH_TOKEN=1` if both key and bearer must be passed to the child (see `envForClaudeChat()`).
4. `export BRAIN_CHAT_BACKEND=sdk`
5. From repo root: `node app/server.js`  
6. Optional: `export BRAIN_CHAT_MCP_DB=1` so chat can call the read-only `brain_select` MCP tool against `DB_DIR/*.db`.

Restart the server after any env change.

**Local: `spawn claude ENOENT` (or “Failed to start Claude Code”)**  
That message comes from **`BRAIN_CHAT_BACKEND=cli`** (the default): the server runs `spawn(CLAUDE_BIN, …)` and `CLAUDE_BIN` defaults to the string `claude`, which only works if `claude` is on the **`PATH` of the Node process**.

- If you start the app from **Cursor / VS Code / a GUI** without env vars, `CLAUDE_BIN` / `CLAUDE_CODE_EXECUTABLE` are often **unset**, so you get ENOENT even though the same path works in a terminal one-off.
- **Fix (pick one):**  
  - Set **`BRAIN_CHAT_BACKEND=sdk`** *and* set **`CLAUDE_CODE_EXECUTABLE`** (or **`CLAUDE_BIN`**) to the full path to `claude` in the **same** environment the IDE uses to launch Node; **or**  
  - Stay on CLI and set **`CLAUDE_BIN`** or **`CLAUDE_CODE_EXECUTABLE`** to that full path for the IDE process (the server treats both the same for the CLI spawn).

To find the path in a shell where `claude` already works: `command -v claude` (often under `~/.nvm/versions/node/.../bin/claude` for a given Node version).

---

**Fly.io checklist (`BRAIN_CHAT_BACKEND=sdk`)**

1. **Deploy an image** built from the current `Dockerfile` (includes `app/chat-sdk-runner.mjs`, `app/mcp-brain-db.mjs`, and `npm install` for the SDK).
2. **`fly secrets set`** (or `[env]` in `fly.toml` for non-secret flags) at minimum:  
   - `ANTHROPIC_API_KEY` (if not already set)  
   - `BRAIN_CHAT_BACKEND=sdk`
3. Optional secrets: `BRAIN_CHAT_MCP_DB=1`, `BRAIN_CHAT_TOOLS`, `BRAIN_CHAT_PERMISSION_MODE`, `CLAUDE_CODE_EXECUTABLE`, etc. (see table below).
4. **`fly deploy`**, then **`fly apps restart <app>`** if you only changed secrets (or rely on Fly’s secret rollout as you prefer).
5. Same volume as before: `DATA_DIR` / `DB_DIR` are `/data`; chat sessions and optional `chat-tool-audit.log` live there too.

---

Other useful environment variables (SDK path):

| Variable | Purpose |
|----------|---------|
| `BRAIN_CHAT_RESUME` | Set to `0` to disable SDK session resume (always send a text transcript instead). |
| `BRAIN_CHAT_TOOLS` | `preset` (default), `readonly` (`Read`/`Glob`/`Grep` only), or comma-separated tool names. |
| `BRAIN_CHAT_ALLOWED_TOOLS` | Optional comma list of tools to auto-allow (SDK `allowedTools`). |
| `BRAIN_CHAT_PERMISSION_MODE` | `bypassPermissions` (default, matches prior CLI flag), `acceptEdits`, `default`, `plan`, or `dontAsk`. |
| `BRAIN_CHAT_MCP_DB` | Set to `1` to attach the `brainDb` MCP server (`brain_select`: read-only `SELECT` on the four SQLite files). |
| `BRAIN_CHAT_AUDIT_TOOLS` | Set to `0` to disable `PostToolUse` append-only logging to `DB_DIR/chat-tool-audit.log`. |
| `BRAIN_CHAT_MAX_TURNS` | Agent SDK max turns (default `100`). |
| `CLAUDE_BIN` | Full path to the `claude` binary for **CLI** chat (default backend). If unset, the server tries `CLAUDE_CODE_EXECUTABLE`, then the string `claude` on `PATH`. |
| `CLAUDE_CODE_EXECUTABLE` | Same as `CLAUDE_BIN` for resolving the binary (either may be set). Also passed to the Agent SDK. Use a **full path** when the IDE or service does not load your shell `PATH`. |

### Fly.io runbook (deploy and verify)

1. **CLI:** `fly auth login` then from the repo root (where [`fly.toml`](../fly.toml) lives):  
   `fly deploy`  
   Fly uses the `app = '…'` name in `fly.toml` automatically; or pass `--app <name>`.

2. **Secrets (typical):** at minimum **`ANTHROPIC_API_KEY`** for dashboard chat on Fly (subscription-from-laptop does not apply; see “Claude subscription” above). Strongly **`DASHBOARD_PASSWORD`** for a public URL. **`BRAIN_API_TOKEN`** if you use `scripts/db` or `POST /api/db` against production.  
   Example:  
   `fly secrets set ANTHROPIC_API_KEY="sk-ant-..." DASHBOARD_PASSWORD='…' BRAIN_API_TOKEN='…'`

3. **`CLAUDE_BIN` on Fly:** the image installs `@anthropic-ai/claude-code` globally; inside the container the binary is on **`PATH`** as `claude`. Do **not** set `CLAUDE_BIN` to a **macOS** path from your laptop — that will fail with `ENOENT` in production. Prefer **`fly secrets unset CLAUDE_BIN`**, or set **`CLAUDE_BIN=claude`**.

4. **Agent SDK on Fly:** `fly secrets set BRAIN_CHAT_BACKEND=sdk` (or add `BRAIN_CHAT_BACKEND = "sdk"` under `[env]` in `fly.toml` for a non-secret default). Optional: `BRAIN_CHAT_MCP_DB=1`, etc.

5. **Volume:** `fly.toml` mounts `brain_data` at **`/data`** (`DATA_DIR` / `DB_DIR`). Upload the four `*.db` files to `/data/` (e.g. `fly sftp shell`, then `put` from local `data/`). Restart after seeding if needed: `fly apps restart <app>`.

6. **Smoke test:**  
   `curl -sS "https://<app>.fly.dev/api/health"`  
   should return JSON with `"ok":true`. Open the same host in a browser; sign in at `/login.html` if `DASHBOARD_PASSWORD` is set.

---

## Adding a New Agent

1. Create `team/<name>.md` with role, responsibilities, tool access, and DB write permissions
2. If the agent needs a new DB table: ask Arc to design the schema, update the relevant `.sql` file, apply to the DB
3. If the agent produces dashboard-visible data: it should write to `brain.db.action_items` and/or the relevant domain DB
4. Register the agent in `CYRUS.md` routing table

## Adding a New Dashboard Section

1. Add the query to the relevant endpoint in `app/server.js`
2. Add the HTML skeleton to the relevant page div in `app/dashboard.html`
3. Add the render logic to the corresponding `renderX()` function in the `<script>` block
4. No build step needed — just restart `node app/server.js`

## Modifying a Database Schema

1. Edit the `.sql` schema file in `data/` first (source of truth)
2. Apply the change: `sqlite3 data/<name>.db < data/<name>.sql` (careful — this recreates tables)
3. For additive changes (new column): use `ALTER TABLE ... ADD COLUMN ...` directly
4. Update any affected views, then update `app/server.js` queries if column names changed
