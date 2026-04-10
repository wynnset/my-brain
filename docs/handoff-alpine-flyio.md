# Handoff: Dashboard (Alpine) → Fly.io Deploy

**Created:** 2026-04-09  
**Last updated:** 2026-04-09  
**Repo:** `my-brain`  
**Start server:** `node app/server.js` (from repo root)  
**Local URL:** `http://localhost:3131`

---

## Executive summary

| Area | Status |
|------|--------|
| **Alpine.js dashboard** | Done — declarative UI, split across `dashboard.html` + `dashboard-app.js` + `dashboard.css` |
| **Chat panel** | Done — thread UI, History / New, server-backed sessions under `DB_DIR/chat-sessions/`, SSE heartbeats + Activity log, desktop resize, mobile FAB + full-screen |
| **Files page** | Done — desktop: list left, viewer/editor right; mobile: modals |
| **Docker image** | Ready — Node 20 Alpine, Claude Code CLI, volume init script |
| **Fly.io** | **You deploy** — `fly.toml` includes `DB_DIR`; run the checklist below after `fly auth login` |

---

## Backend: `app/server.js`

All endpoints below are implemented. The dashboard loads **home** from `GET /api/dashboard` and **career / finance / business** from dedicated routes (smaller, page-scoped payloads).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/dashboard` | Aggregated DB payload for the home page |
| `GET` | `/api/career` | Career page data |
| `GET` | `/api/finance` | Finance page data |
| `GET` | `/api/business` | Business page data |
| `POST` | `/api/db` | Write gate for agents (Bearer token) |
| `GET` | `/api/chat/conversations` | List saved chat sessions (metadata from `DB_DIR/chat-sessions/*.json`) |
| `POST` | `/api/chat/conversations` | Create session `{ agent }` → `{ id }` |
| `GET` | `/api/chat/conversations/:id` | Full session + messages |
| `DELETE` | `/api/chat/conversations/:id` | Remove session file |
| `POST` | `/api/chat` | Body `{ agent, prompt, conversationId }` — loads transcript from JSON, streams Claude CLI + SSE (heartbeats, `status`, `text`, `error`) |
| `GET` | `/api/files` | Lists `owners-inbox`, `team-inbox`, `team`, `docs`, root (`CYRUS.md`) |
| `GET` | `/api/files/:dir/:name` | Read / download |
| `PUT` | `/api/files/:dir/:name` | Save `.md` / `.html` / `.txt` / `.json` |
| `POST` | `/api/upload` | Upload → `team-inbox` (multer) |
| `GET` | `/api/cyrus` | Read `CYRUS.md` (orchestrator brief) |
| `PUT` | `/api/cyrus` | Write `CYRUS.md` |
| `GET` / `PUT` | `/api/larry` | Legacy alias — same file as `/api/cyrus` |

### Environment variables

```js
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');   // repo root
const DB_DIR   = process.env.DB_DIR   || path.join(__dirname, '..', 'data');
// Chat transcripts: `DB_DIR/chat-sessions/{uuid}.json` — keep `DB_DIR` on a persistent Fly volume.
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
```

### Chat disconnect bug (already fixed)

Use `res.on('close')` (not `req.on('close')`) to kill the child process when the client disconnects. `req.on('close')` can fire too early and terminate Claude before it runs. The server pipes system prompt + user message on **stdin** (not `--system-file`).

---

## Frontend: layout and stack

| File | Role |
|------|------|
| `app/dashboard.html` | Markup, Tailwind CDN, Lucide + `dashboard-app.js` + Alpine CDN (load order: Lucide script, app script, **defer** Alpine) |
| `app/dashboard-app.js` | `Alpine.data('app', …)` — state, navigation, data loading, chat, files, theme |
| `app/dashboard.css` | Shared styles (e.g. skeletons, `x-cloak`) |

**CDNs (pinned in HTML):**

- Tailwind (browser)
- Alpine **3.14.8**
- Lucide **0.469.0**

**Routing:** Hash routes `#/`, `#/career`, `#/finance`, `#/business`, `#/files`. There is **no** `#/chat` page; `#/chat` opens the chat panel and keeps the current page context (`onHashChange` in `dashboard-app.js`).

**Theme:** Stored in `localStorage` as `theme` with values `system` | `light` | `dark` (UI label cycles Auto → Light → Dark).

---

## Chat panel (implemented behavior)

- **Toggle:** Icon button in the top nav (right of refresh metadata), **next to** the theme control — Lucide `message-square`, not a primary nav tab.
- **Default:** `chatOpen: true` on load; after agents load, `focusChatPrompt()` focuses the desktop or mobile textarea.
- **Desktop (`lg+`):** Fixed panel from below the nav to the bottom; width **280–720px**, persisted as `localStorage.chat_panel_width` (default 384). Narrow drag strip on the **left** edge of the panel (`cursor-col-resize`); subtle hover line.
- **Mobile:** FAB (bottom-right) when chat is closed; full-screen overlay when open, with header close.
- **Streaming:** Assistant output is shown with `x-text` (plain text), not `innerHTML`, for safety.
- **Attachments:** Drag/drop or click → staged files; on send, `POST /api/upload` then `POST /api/chat`.

---

## Files page (implemented behavior)

- **`lg+`:** Two-column layout — file list in a fixed-width left column (`lg:w-80` / `xl:w-[22rem]`), viewer or editor in the right pane. Empty state when nothing selected.
- **`<lg`:** Same list; **View** / **Edit** open modal overlays (viewer `pre`, editor `textarea` + Save).

---

## `scripts/db`

Shell wrapper (also copied to `/usr/local/bin/db` in the image). Routes:

- **In Fly container** (SQLite files under `/data/*.db`): direct `sqlite3`
- **On Mac locally:** `POST /api/db` with Bearer token

---

## Docker (`Dockerfile`)

- Base: `node:20-alpine`; adds `bash`, `curl`, `jq`, `sqlite`
- Installs **`@anthropic-ai/claude-code`** globally (ensure `CLAUDE_BIN` on Fly points at the `claude` binary on `PATH`, or override)
- Copies `app/server.js`, `app/package.json`, `app/dashboard.html`, `app/dashboard.css`, `app/dashboard-app.js`
- Seeds **only** tree content + config into the image under `/app/seed/`; `init-volume.sh` copies to `/data` on **first** boot (see below). **Database files are not** in the image — they must be uploaded to the volume (or created) after deploy.

**CMD:** `init-volume.sh && node server.js`

---

## `scripts/init-volume.sh`

Runs once when `/data/.initialized` is missing: creates dirs, copies `team/`, `docs/`, `CYRUS.md`, `config.json` from `/app/seed/` into `/data/`. Does **not** copy `.db` files; seed those separately (Fly SFTP or another path).

---

## Fly.io (deployment)

**Prerequisite:** `flyctl` installed (`fly version`) and logged in (`fly auth login`).

### Current `fly.toml` (repo root)

```toml
app = "my-brain-dashboard"
primary_region = "yyz"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT     = "8080"
  NODE_ENV = "production"
  DATA_DIR = "/data"
  DB_DIR   = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size   = "shared-cpu-1x"
  memory = "512mb"

[mounts]
  source      = "brain_data"
  destination = "/data"
```

**Note:** `fly.toml` sets `DB_DIR = "/data"` under `[env]` (aligned with `ENV DB_DIR=/data` in the Dockerfile).

### Deploy checklist

**Prerequisite — Fly account (one time):** Open [https://fly.io/app/sign-up](https://fly.io/app/sign-up), create an account, and add a payment method if Fly asks (they often require a card for new orgs even on free allowances).

**Prerequisite — CLI login (this machine):**

```bash
fly auth login
```

Complete the browser flow; then verify with `fly auth whoami`.

**Order matters:** create the **app** before the **volume** (volumes are per app). Use the app name from `fly.toml` (`my-brain-dashboard`) and region `yyz`.

```bash
cd /path/to/my-brain   # repo root

# 1. Register the app on Fly without deploying (uses existing fly.toml)
fly launch --no-deploy --copy-config -y

# 2. Volume (one time, same region as primary_region)
fly volumes create brain_data --app my-brain-dashboard --region yyz --size 5

# 3. Secrets (generate BRAIN_API_TOKEN first so you can save it for scripts/db)
export BRAIN_API_TOKEN="$(openssl rand -hex 32)"
echo "Save for local agents: $BRAIN_API_TOKEN"
fly secrets set --app my-brain-dashboard \
  ANTHROPIC_API_KEY="sk-ant-..." \
  BRAIN_API_TOKEN="$BRAIN_API_TOKEN" \
  CLAUDE_BIN="claude"

# 4. Deploy
fly deploy --app my-brain-dashboard

# 5. Seed SQLite files onto the volume (not in Docker seed)
# Stop local `node app/server.js` first so *.db files are not mid-write.
fly sftp shell --app my-brain-dashboard
# At the sftp> prompt, from your machine paths (examples):
# put data/brain.db /data/brain.db
# put data/launchpad.db /data/launchpad.db
# put data/finance.db /data/finance.db
# put data/wynnset.db /data/wynnset.db
exit

# 6. Restart so the app picks up new DB files cleanly
fly apps restart my-brain-dashboard

# 7. Smoke test (URL matches app name)
curl -sS "https://my-brain-dashboard.fly.dev/api/health"
```

**If the Fly app name `my-brain-dashboard` is already taken globally**, change `app = "..."` in `fly.toml` to an available name, then run `fly launch --no-deploy --copy-config -y` again (or rename in the Fly dashboard and align `fly.toml`).

### Local machine → Fly API (agents)

```bash
export BRAIN_APP_URL="https://my-brain-dashboard.fly.dev"
export BRAIN_API_TOKEN="<same as fly secret>"
# Optional: sudo cp scripts/db /usr/local/bin/db && sudo chmod +x /usr/local/bin/db
```

---

## Manual UI testing checklist

Use after deploy or any dashboard change.

### Navigation & shell

- [ ] Home, Career, Finance, Business, Files — hash routing and refresh
- [ ] `#/chat` opens chat without losing page
- [ ] Theme cycles Auto / Light / Dark and persists (`system` / `light` / `dark`)
- [ ] Mobile hamburger menu

### Data pages

- [ ] Home: action items, domain cards, week card (`/api/dashboard`)
- [ ] Career, Finance, Business: tables and sections load (`/api/career` etc.)
- [ ] Action item sort / group / range on each page
- [ ] Skeletons while loading; errors surface if API fails

### Chat

- [ ] Header icon toggles panel (desktop); FAB + full-screen (mobile)
- [ ] Panel open by default; prompt focused after load
- [ ] Desktop: drag left edge resizes width; survives reload
- [ ] Agent list includes `cyrus` (orchestrator) and team files
- [ ] Enter sends, Shift+Enter newline; streaming + Stop
- [ ] Attachments upload on send

### Files

- [ ] Desktop: list left, view/edit right
- [ ] Mobile: modals for view/edit
- [ ] Download, save, page drop overlay → `team-inbox`

### Responsive

- [ ] ~375 / 768 / 1280 widths; no bad horizontal scroll on main content

---

## Key file map

| Path | Notes |
|------|------|
| `app/server.js` | Express API — change only for backend fixes or new endpoints |
| `app/dashboard.html` | Alpine root, nav, pages, chat aside, modals |
| `app/dashboard-app.js` | All dashboard logic |
| `app/dashboard.css` | Shared CSS |
| `app/package.json` | `express`, `better-sqlite3`, `multer` |
| `Dockerfile` | Production image |
| `fly.toml` | Fly app config |
| `scripts/db` | DB CLI wrapper |
| `scripts/init-volume.sh` | First-boot volume seed (no `.db`) |
| `data/*.db` | SQLite — deploy to Fly volume separately |
| `CYRUS.md`, `team/*.md` | Agent definitions |

---

## Next session (if anything is left)

1. **Fly.io:** After CLI login, run the deploy checklist above; copy four DBs (`brain`, `launchpad`, `finance`, `wynnset`) to `/data`; verify `/api/health` and the dashboard in the browser.
2. **Frontend:** Only if new product requirements — keep edits in `dashboard.html` / `dashboard-app.js` / `dashboard.css` and preserve Alpine + Lucide init order.
3. **Backend:** Avoid drive-by changes; extend only when the API contract needs to grow.
