# Cyrus — System Overview

Cyrus is a personal AI-powered command centre for career, finance, and business management. It combines a team of specialised AI agents with a set of SQLite databases and a local web dashboard.

---

## Folder Structure

```
my-brain/   (repo directory name may differ)
├── CYRUS.md            # Cyrus brief: orchestrator of the AI team
├── app/                # Dashboard web app
│   ├── server.js       # Express server — reads all 4 DBs, exposes API
│   ├── dashboard.html  # Single-file SPA (Tailwind, vanilla JS, hash routing)
│   └── package.json    # Dependencies: express, better-sqlite3, open
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
