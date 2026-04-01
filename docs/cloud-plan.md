# Cloud Migration Plan

## Goal

Make `/my-brain` accessible from anywhere (phone, web) while keeping Claude Code fully functional. No custom server to maintain. Free tier throughout.

---

## Architecture

```
Claude Code Web (claude.ai/code)
    └── connects to → private GitHub repo (wynnset/my-brain)

Browser / Phone
    └── opens → static dashboard site (Cloudflare Pages)
                    ├── reads files via GitHub API
                    ├── reads DB via Turso
                    └── drops files → commits to team-inbox/ via GitHub API
```

---

## The Repo Is Already There

`/my-brain` is already a private GitHub repo at `wynnset/my-brain`. Claude Code web can connect to it directly — no migration needed for files.

---

## Work Breakdown

### 1. Dashboard — static site on Cloudflare Pages (Frame)

Current `dashboard.html` loads the SQLite DB via a local file picker. This needs to change:

- Remove the file picker
- Fetch DB data from **Turso** instead (see below)
- Add a **file browser panel** — calls GitHub API to list the repo's directory tree, click to view file contents
- Add a **drag-drop / file input zone** — on drop, commits the file to `team-inbox/` via GitHub API
- Deploy the single HTML file to Cloudflare Pages (free, automatic on push to `main`)

Phone note: drag-and-drop needs a regular `<input type="file">` fallback for mobile browsers.

### 2. Database — migrate to Turso

`data/launchpad.db` is a SQLite file that changes frequently. Committing it to git constantly is messy.

- Create a free [Turso](https://turso.tech) account
- Push the existing schema (`data/launchpad.sql`) to a new Turso database
- Import current data from `launchpad.db`
- Update the dashboard to query Turso via their HTTP API (no SDK needed — plain `fetch`)
- All Claude Code agents that currently read/write the DB need their connection updated to use Turso's libSQL client

Turso free tier: 500 databases, 9GB storage — more than enough.

### 3. GitHub API auth (for file browser + drop zone)

The dashboard needs read/write access to the repo:

- Create a GitHub **fine-grained personal access token** scoped to `wynnset/my-brain` only
- Permissions needed: `Contents: Read and Write`
- Store the token as a Cloudflare Pages environment variable (never in the HTML)
- The dashboard fetches the token from a Cloudflare Pages Function (one small serverless function, ~20 lines) so it's never exposed to the browser

### 4. Cloudflare Pages deploy

- Connect Cloudflare Pages to `wynnset/my-brain`
- Set build output to repo root (no build step — it's a single HTML file)
- Every push to `main` auto-deploys
- Free custom subdomain: `my-brain.pages.dev` (or bring your own domain)

---

## What Changes for Claude Code

Nothing. Claude Code web connects to `wynnset/my-brain` on GitHub. It reads and writes files in the repo exactly as the CLI does locally. All agents work the same way — they just commit changes instead of writing to disk directly.

The only adjustment: any agent that writes to `launchpad.db` locally will need to use the Turso client instead. This is a one-line connection change per agent.

---

## Sequence

1. **Turso setup** — create DB, import schema + data, get connection URL + token
2. **Dashboard update** (Frame) — swap file picker for Turso, add file browser, add drop zone
3. **Cloudflare Pages setup** — connect repo, add env vars, verify deploy
4. **Agent DB connections** — update any agent that reads/writes `launchpad.db` to use Turso
5. **Smoke test** — open dashboard on phone, drop a file, verify it lands in `team-inbox/`

---

## What This Costs

| Service | Cost |
|---|---|
| GitHub private repo | Free |
| Cloudflare Pages | Free |
| Turso (personal tier) | Free |
| **Total** | **$0/month** |

---

## Out of Scope (keep it simple)

- Editing or deleting files from the UI — use Claude Code web for that
- Real-time DB sync — Turso handles persistence natively
- Multi-user access — single token, single owner
