# Cyrus — system overview

Your account is a **tenant** on a shared server: this folder is your **workspace**; SQLite files and chat data live next to it under **`data/`** on the same volume. Nothing here is visible to other tenants.

## Directory layout

| Path | Purpose |
|------|---------|
| **`CYRUS.md`** | Orchestrator brief — used as the system prompt when you chat with **Cyrus**. Edit to match how you want work routed. |
| **`config.json`** | App settings (e.g. currency, thresholds). Database paths are under your tenant **`data/`** (same UUID as this workspace). |
| **`docs/`** | Reference for you and for agents. **`docs/profile.md`** is the right place for your background, goals, and tone so chat stays accurate. |
| **`team/`** | Optional: one **`.md`** file per specialist agent (filename = agent id). Empty is fine until you add personas; chat defaults to Cyrus only. |
| **`owners-inbox/`** | Where agents should drop finished reports and artifacts. |
| **`team-inbox/`** | Drop files you want the team to ingest or process. |

## Data (`../data/` from this workspace)

| Path | Purpose |
|------|---------|
| **`brain.db`** | Cross-domain **action items** — the main todo ledger the dashboard reads first. |
| **`*.db`** | Optional domain databases (e.g. career, finance). They appear in the app when present; empty sections otherwise. You can add SQLite files via the dashboard **`POST /api/db`** (or your host’s documented tooling). |
| **`chat-sessions/`** | Saved dashboard chat threads (JSON). |
| **`chat-tool-audit.log`** | Optional append-only log of tool use from chat (if enabled on the server). |
| **Server runtime data** | The host may create dot-prefixed directories under your tenant `data/` for chat isolation — do not delete them while the app is running. |

## Identity in chat

The server attaches your **login** and **display name** from **`registry.db`** to the chat system prompt so “who am I?” matches **your** account. For anything richer than a name, keep **`docs/profile.md`** up to date.

## Dashboard & chat (host-controlled)

How the web UI connects to the assistant, billing, and availability are decided by the **server operator** (hosting configuration and secrets). They are not documented in this workspace on purpose.

Ask your administrator for URLs, login, and support.

## Adding a specialist agent

1. Add **`team/<slug>.md`** (role, behavior, what it may assume about databases and files).  
2. If Cyrus should route to them, mention them in **`CYRUS.md`**.  
3. If they write dashboard-visible work, use **`brain.db`** `action_items` and/or the right domain DB.

## Removing this tenant

Account removal is done by the host (registry row + **`users/<uuid>/`** tree). Not something you delete from inside this workspace alone.
