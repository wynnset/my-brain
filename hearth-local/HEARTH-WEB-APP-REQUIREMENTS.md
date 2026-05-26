# Hearth — Rental Scout Web App: Requirements

> A standalone, cloud-synced rental-search app for one user (Aidin, Vancouver
> BC). Collects rental listings from multiple sources, scores them against
> personal "soft" criteria using the Claude API, and presents a dashboard
> (Mac / iPad / iPhone) where listings can be browsed, filtered, and manually
> corrected. **No dependency on the "Cyrus" workspace — the entire experience
> lives in this app.**
>
> This document is the brief for a fresh build in a new repo. It carries over
> everything learned from the working prototype (`hearth-local/hearth_fbm.py`)
> so the build doesn't repeat solved problems.

---

## 0. Decisions (resolved 2026-05-26)

These were the open build choices; they are now settled. The rest of the doc
reflects them.

| # | Decision | Choice |
|---|----------|--------|
| 1 | Cloud stack | **Supabase + JS frontend** (Postgres, auth, storage, realtime, edge functions; frontend Next.js/SvelteKit on Vercel). |
| 2 | "Collect now" trigger | **Push channel + schedule** — Mac holds a live channel (WebSocket/SSE, or Supabase Realtime) so the cloud can trigger instantly, *plus* a `launchd` schedule. |
| 3 | Photos | **Hotlink original URLs** — store the source image URL, load directly. No storage. (Accepted risk: some FB/CDN links expire over time; revisit if breakage is annoying.) |
| 4 | Scoring | **Cheapest text-only model, no vision** — score from `raw_text`; never analyze photos. |
| 5 | Hard-filter behavior | **Keep-and-mark** (default) — listings that fail hard filters stay in the DB with `hard_filter_pass=0`, hidden from the default view but reachable via a "show filtered" toggle. |
| 6 | Mac app shell | **Native window embedding the dashboard, via `pywebview` — part of v0, not optional.** The Mac app is one `.app`: a WKWebView window showing the dashboard *plus* the Python collector running in the background. The dashboard and the Playwright scraping browser stay separate engines (§4.1). |
| 7 | Frontend framework | **Next.js + React + Tailwind**, deployed on Vercel as a PWA. One hosted build serves the Mac app's WebView, iPad, and iPhone. |

---

## 1. Goal & non-goals

**Goal:** one self-contained app that answers "what are the best 2BR rentals in
Vancouver for me right now?" — pulling from Facebook Marketplace, Craigslist,
and Rentals.ca, scoring each against weighted soft criteria, and letting the
user manage the search from any of their Apple devices.

**Non-goals (v1):**
- No multi-tenant / multi-user. Single user, single search profile.
- No automated landlord contact or messaging.
- No native **iOS/iPadOS** app — those use the dashboard as a PWA. (The **Mac**
  does get a native `pywebview` shell around the same dashboard — Decision #6 —
  because the collector must run there anyway.)
- Not tied to Cyrus, `brain.db`, or any external workspace.

---

## 2. The one hard constraint that shapes everything

**Facebook Marketplace requires a real, logged-in desktop browser.**
- FB blocks datacenter IPs, so scraping **cannot** run on a cloud server.
- iOS/iPadOS cannot run browser automation (no Playwright), and an App Store app
  that scrapes Facebook would be rejected.
- Therefore the **collector must run on the user's Mac**, using a persistent
  logged-in browser session. Craigslist also blocks plain HTTP clients and is
  scraped through the same browser.

Everything else (storage, scoring, dashboard) can be in the cloud. This yields a
**split architecture**: Mac collector → cloud backend → web dashboard.

---

## 3. Architecture (cloud-synced)

```
┌────────────────────── USER'S MAC (.app) ────────────────────────┐
│ Single native app (pywebview), two engines side by side:         │
│                                                                  │
│  ┌── WKWebView window ──┐      ┌── Collector (Python) ────────┐  │
│  │ embeds the dashboard │      │ Playwright headed/persistent │  │
│  │ (same UI as iPad/    │      │ • logs into FB once, session │  │
│  │  iPhone, §6)         │      │   persists locally           │  │
│  └──────────────────────┘      │ • scrapes FB/CL/Rentals.ca   │  │
│         UI engine               │ • location / subarea filters │  │
│   (NOT used for scraping)       │ • clean content extraction   │  │
│                                 │ • pushes listings to cloud   │  │
│                                 │ • Realtime channel + launchd │  │
│                                 └──────────────────────────────┘  │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS / Supabase Realtime
                ▼
┌──────────────────────── CLOUD (Supabase) ──────────────────────┐
│ Postgres + Auth + Storage + Realtime + Edge Functions          │
│  • ingest: upsert listings (idempotent)                        │
│  • scorer (Edge Function): Claude API → fields + scores + flags │
│  • hard-filter + scam-flag logic                               │
│  • CRUD for manual edits / status / overrides                  │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS  (same dashboard served to all clients)
                ▼
┌──────────── WEB DASHBOARD (Next.js/React PWA) ─────────────────┐
│ Rendered in: the Mac app's WKWebView · iPad/iPhone browser     │
│  • ranked listings, filters, detail view, manual edits         │
└─────────────────────────────────────────────────────────────────┘
```

**Secrets placement (important):**
- The **Facebook session** never leaves the Mac.
- The **Anthropic API key** lives server-side (cloud), used only by the scorer.
  (Do not put it in the collector or the browser.)
- A single **API token** authenticates the Mac collector → cloud ingest, and the
  dashboard → cloud API.

---

## 4. Components

### 4.1 Mac collector agent
Port the existing prototype (`hearth-local/hearth_fbm.py`) — it already solves
the hard parts. Keep:
- **Persistent login**: Playwright `launch_persistent_context` with a local user
  data dir so the FB session survives runs; a `login` command opens a headed
  browser for first-time login / CAPTCHAs.
- **Sources** (all via the browser):
  - **Facebook Marketplace** — config: one or more search-result URLs (must be
    built with Location=Vancouver + radius + category=Property Rentals; bare
    `?query=` searches ignore location).
  - **Craigslist** — config: site (`vancouver`), `subareas` (e.g. `["van"]` =
    city of Vancouver; codes read from URL path: `van`, `bnc`=Burnaby/NewWest,
    `nvn`=north shore, `rds`=richmond/delta, `pml`=tri-cities), price, beds;
    optional `search_distance`+`postal` or pasted search URLs.
  - **Rentals.ca** — config: search URL(s) + a link-matching regex. Works well.
  - **PadMapper / Zumper** — optional/best-effort (map SPAs with anti-bot);
    leave as toggles, off by default.
- **Filtering** (keep results local to target area):
  - Host filter for Craigslist (only `{site}.craigslist.org`).
  - Subarea filter on the CL URL path.
  - `location_allow` / `location_block` term lists, matched against listing
    **text AND the URL slug** (catches "burnaby-north-burnaby" in the path even
    when page chrome says "vancouver").
- **Content extraction** (the recently-solved problem — do NOT regress to
  `document.body.innerText`):
  - Craigslist: exact fields — `#postingbody`, `.price`, `.attrgroup`,
    `.mapaddress`, title.
  - Others: the **main content region** (`[role="main"]` → `<main>` →
    `<article>`), trimmed of the trailing "suggested / more like this /
    sponsored" sections (cut at known markers, only when past ~200 chars), with
    `og:title` / `og:description` prepended. Click "See more" first to expand
    truncated descriptions.
  - Capture the **cover photo** (`og:image`). Consider downloading and
    re-uploading photos to cloud storage (FB CDN URLs can expire / require auth)
    — see §11.
- **Dedupe**: a per-source "seen" set so re-runs only push new listings.
- **Output → push**: instead of writing a local file, POST a JSON array of
  listing rows to the cloud ingest endpoint (§7). Keep a local file export as a
  fallback/debug option.
- **Schedule**: `launchd` plist (or a `--watch` loop) for 1–2× daily runs. Note:
  FB may require re-login periodically; the run should detect "logged out" (zero
  links found) and surface a clear "re-run login" message / notification.

### 4.1a Native Mac shell (v0, required — Decision #6)
The collector ships as a **single native macOS `.app` built with `pywebview`**,
so the user has one Dock icon instead of a headless background script.
- **One window = the dashboard.** The app opens a `WKWebView` (macOS system web
  engine) pointed at the dashboard — either the live Vercel URL (UI auto-updates,
  needs network) or a bundled build (works offline; rebuild to update). Default
  to the **live URL** for v0. The user sees the exact same dashboard as on
  iPad/iPhone, just in a native window.
- **Collector runs in the same app, in the background.** The Python collector
  (§4.1) runs on a thread/subprocess within the `.app`, driving Playwright and
  pushing to the cloud. Starting the app brings the collector online (Realtime
  channel + schedule); quitting it takes the collector offline.
- **Critical separation of the two browser engines:** the `WKWebView` is **only**
  the UI. Scraping happens in a **separate Playwright-driven Chromium** instance.
  Do **not** attempt to scrape Facebook inside the `WKWebView` — it isn't
  automatable like Playwright and FB login/anti-bot would break. Two engines,
  different jobs: WebView = display, Playwright = scrape.
- **First-run Facebook login** still opens the headed Playwright browser window
  (separate from the app window) so the user can log in / clear CAPTCHAs once.
- **Status surface:** the app should make collector state visible (online/idle,
  last run + counts, "needs Facebook re-login"). Simplest is for the dashboard to
  show this from cloud data (`runs` + a heartbeat); a small native menu-bar
  indicator is a nice-to-have, not required for v0.
- **Packaging:** bundle with PyInstaller/py2app, including the Playwright browser
  binaries. For personal use, skip Apple notarization (first launch via
  right-click → Open). Expect a chunky `.app` due to the bundled browser.

### 4.2 Cloud backend
- **Ingest API**: accept listing batches from the collector, upsert by
  `(source, source_listing_id)`. Idempotent. Records a "collection run" with
  per-source counts and timestamp.
- **Scorer** (see §8): for listings that are new/unscored, call Claude to extract
  structured fields + score soft criteria + flag red flags. Batched, rate-limit
  aware, cheap.
- **Hard-filter + scam-flag**: applied after structured fields exist.
- **CRUD API**: read listings (with filters/sort), update status, edit
  AI-parsed fields, override scores, add notes; read/update the criteria config.
- **Serves** the dashboard (static assets) + JSON API.

### 4.3 Web dashboard (PWA)
See §6. Cross-platform via responsive web; installable to the iOS/iPadOS home
screen with a manifest + service worker.

---

## 5. Data model

Start from the prototype's `rentals.db` schema and extend for the app. (SQLite
column intent shown; adapt types if Postgres — see §10.)

### `listings`
Existing columns: `id`, `source`, `source_listing_id`, `url`, `title`,
`description`, `price_monthly` (CAD cents), `bedrooms`, `bathrooms`, `sqft`,
`neighbourhood`, `address`, `lat`, `lng`, `posted_at`, `scraped_at`,
`photos_json`, `hard_filter_pass` (0/1), `composite_score`, `status`
(`new`|`shortlisted`|`contacted`|`viewed`|`rejected`|`dead`), `notes`,
`UNIQUE(source, source_listing_id)`.

Add for the app:
- `raw_text` — the captured listing content (what the scorer reads).
- `score_override` (REAL, nullable) — user-set composite that wins over the AI's.
- `manually_edited` (0/1) and `edited_fields_json` — which fields the user
  corrected, so re-scoring doesn't clobber them.
- `is_hidden` / `archived` (0/1).
- `created_at`, `updated_at`.
- `cover_photo_url` (the chosen display image; may point to re-hosted copy).

### `scores`
Existing: `id`, `listing_id`, `criterion`, `score` (0–10), `rationale`,
`scored_at`, `UNIQUE(listing_id, criterion)`.
Add: `overridden` (0/1) + keep the original AI score when a user overrides.

### `flagged`
Existing: `id`, `listing_id`, `reason`
(`price_anomaly`|`stock_photos`|`broker_mill`|`wire_deposit`|`incomplete`|`other`),
`detail`, `flagged_at`. Add `dismissed` (0/1) so the user can clear a false flag.

### New tables
- `criteria` (or a single JSON settings row) — the editable search profile:
  hard filters (price range, min beds, parking, etc.), soft filters with weights,
  hard exclusions, scam heuristics, scorer notes. Editable in the dashboard.
  This replaces the static `rental-criteria.md`.
- `runs` — collection-run log: `id`, `started_at`, `finished_at`,
  `counts_json` (per source: found / new / skipped / off-area), `source` of run
  (manual/scheduled), any error.
- `settings` — API token(s), source configs (FB/CL/sites), schedule, scoring
  model + on/off, notification prefs.

---

## 6. Dashboard requirements (the core UX)

**Main list**
- Cards: title, neighbourhood, price, beds/baths, composite score, cover photo,
  source badge (FBM / CL / Rentals.ca), status chip, posted/added date.
- Sort by composite score (default), price, date. Filter by status, source,
  price range, beds, score threshold, "flagged only", "new since last run".
- Quick actions on a card: shortlist, hide/reject, open original URL.

**Listing detail**
- Photo gallery, full description/raw text, map (lat/lng or address link).
- Per-criterion scores **with the AI's rationale** for each, and the weighted
  composite. Show which criteria drove the score.
- Flags (if any) with reason + a "dismiss flag" control.

**Manual editing (explicitly requested — "change things when the AI can't figure
it out")**
- Edit parsed fields: price, beds, baths, neighbourhood, address. Marked as
  user-corrected; protected from being overwritten on re-score.
- Override any per-criterion score and/or the composite.
- Status workflow: new → shortlisted → contacted → viewed → rejected / dead.
- Free-text notes per listing.
- "Re-score this listing" button (re-runs the AI on the current text/fields,
  respecting manual field corrections).

**Controls**
- "Collect now" — triggers a Mac collection run (see §9 on how the cloud signals
  the Mac, since the Mac is the one that can scrape).
- "Score new" — runs the scorer over unscored listings.
- Criteria editor — edit hard/soft filters + weights; changes apply to future
  scoring (and optionally trigger a re-score).
- Run history (from `runs`): when it last ran, counts, any "needs re-login"
  warnings.

**PWA**
- Responsive (phone → tablet → desktop). Installable home-screen icon.
- Optional iOS web-push notification when a run finishes / a high-scoring
  listing appears (iOS 16.4+ supports web push for installed PWAs).

---

## 7. Mac → cloud sync contract

- `POST /api/ingest` with `Authorization: Bearer <token>`, body =
  `{ run: {...}, listings: [ {source, source_listing_id, url, title, raw_text,
  photos:[...], captured_at}, ... ] }`.
- Server upserts by `(source, source_listing_id)`; returns counts (new vs
  duplicate). New listings enter `status='new'`, unscored.
- Collector keeps its own local "seen" set so it only sends genuinely new items;
  server upsert is the safety net.
- Photo handling: send the source photo URLs as-is; the dashboard hotlinks them
  (Decision #3). No server-side fetch or re-host.

---

## 8. Scoring service (Claude API)

**One call per listing (batchable) that does two jobs at once:**
1. **Extract structured fields** from `raw_text`: `price_monthly`, `bedrooms`,
   `bathrooms`, `sqft`, `neighbourhood`, `address` (nulls allowed). This is what
   populates the fields the user can later correct.
2. **Score soft criteria**: for each criterion in the `criteria` config, a 0–10
   score + one-sentence rationale, plus any `red_flags`.

**Output contract (strict JSON):**
```json
{
  "fields": {"price_monthly": 320000, "bedrooms": 2, "bathrooms": 1.0,
             "sqft": null, "neighbourhood": "Kitsilano", "address": null},
  "scores": [{"criterion": "west_or_south_facing", "score": 8,
              "rationale": "..."}],
  "red_flags": ["wire_deposit"]
}
```
- On parse failure: retry once, then flag the listing `incomplete` and move on.
- **Hard filters** applied after extraction (price range, min beds, parking,
  exclusions). Failing → `hard_filter_pass=0`; the listing is **kept in the DB**
  and hidden from the default view but reachable via a "show filtered" toggle
  (Decision #5). Don't score filtered listings.
- **Composite** = Σ(score × weight) over soft criteria, computed server-side from
  the weights in `criteria` (so changing a weight re-ranks without re-calling
  the API). Respect `score_override` when present.
- **Scorer notes** (carried from the prototype's criteria doc): be conservative;
  if orientation/"bright" stated explicitly score high, if implied score mid with
  low confidence; "city view" facing towers is not "unobstructed"; don't invent
  facts (unmentioned criterion → 3–4 "not mentioned", not 0).
- **Model (Decision #4): cheapest text-only model, no vision.** Score from
  `raw_text` only — never send photos to the model. Keep the model id
  configurable in settings so it can be swapped later, but default to the
  lowest-cost capable option (~cents per run for ~50 listings).
- **Rate / cost control**: batch ~5 at a time with a short delay; on HTTP 429
  back off and resume. Score each listing once; re-score only on demand or when
  criteria change.

---

## 9. Triggering collection from the cloud

The dashboard's "Collect now" lives in the cloud, but only the Mac can scrape.

**Decision #2: push channel + schedule.**
- **Push channel:** the Mac collector holds a persistent live connection to the
  cloud — simplest with this stack is **Supabase Realtime** (the collector
  subscribes to a `collect_requests` table/channel; the dashboard inserts a row;
  the Mac is notified instantly and runs). A raw WebSocket/SSE endpoint is the
  fallback if not using Supabase Realtime. The Mac opens the connection outbound,
  so it works behind NAT with no inbound port / tunnel.
- **Schedule:** independently, a `launchd` job runs the collector 1–2× daily so
  listings keep flowing even when no one taps "Collect now".
- The collector should reconnect with backoff if the channel drops, and the
  dashboard should reflect collector online/offline + last-run state.

---

## 10. Tech stack

**Mac app (Decision #6): Python collector wrapped in a `pywebview` native shell.**
- Keep **Python + Playwright** for the collector (reuse the prototype). Add a
  client that subscribes to the cloud push channel (§9) and posts results, plus a
  small config file.
- Wrap it in a **`pywebview`** `.app`: a `WKWebView` window showing the dashboard
  + the collector running in the background of the same process (§4.1a). Package
  with PyInstaller/py2app including the Playwright browser binaries.

**Cloud backend + dashboard (Decision #1): Supabase + a JS frontend.**
- **Supabase** provides Postgres, built-in auth, storage, row-level security, and
  **Realtime** (used both for the collect-trigger channel in §9 and to make the
  dashboard update live as listings sync/score).
- **Scoring** runs in a Supabase **Edge Function** (or a small worker) that calls
  the Claude API with the server-side `ANTHROPIC_API_KEY`.
- **Frontend (Decision #7): Next.js + React + Tailwind**, deployed on Vercel,
  built as a PWA (§6). The same hosted build is what the Mac app's `WKWebView`
  loads and what iPad/iPhone open in the browser — one frontend, all clients.

**Auth:** single user — Supabase Auth (email magic link / password). The
collector authenticates with a separate long-lived service token (not the user
login), scoped to ingest + the collect-request channel.

---

## 11. Cross-cutting concerns

- **Photos (Decision #3 — hotlink):** store and load the source image URLs
  directly; no re-hosting. Known tradeoff: some FB/CDN URLs expire over time, so
  a few thumbnails may eventually break. If that becomes annoying, revisit and
  add collector-side re-hosting to Supabase Storage (`cover_photo_url`).
- **Cost control:** scoring is the only recurring cost, kept low by the text-only
  model (Decision #4). Score each listing once; re-score only on demand or when
  criteria change. Show a rough cost/usage in settings.
- **Privacy:** listing data + your criteria live in Supabase (cloud). The FB
  session and login stay only on the Mac. No third party sees your FB account.
- **Reliability / anti-fragility:** content extraction and link patterns will
  drift as sites change; keep them in config where possible and fail loud (a run
  that finds 0 links should warn, not silently succeed). Keep the local file
  export as a debug fallback.
- **Offline:** PWA can cache the last synced listings for read-only viewing on
  the phone when offline.
- **ToS reality:** scraping FB is against its ToS; this is a personal-use tool
  doing what a human browser does, at human pace, with the user's own session.
  Keep request volume gentle (no aggressive parallelism / tight loops).

---

## 12. Suggested build phases

**v0 (the required baseline) bundles three things:** the synced read-only
dashboard, the cloud ingest path, **and** the native `pywebview` Mac shell
(Decision #6) — so from day one the experience is "open the Mac app, see
listings". Concretely:

0. **Native Mac shell + ingest + dashboard read (v0).** `pywebview` `.app`
   wrapping the existing Python collector; collector pushes to Supabase; a
   dashboard (loaded in the app's `WKWebView` and on iPad/iPhone) lists synced
   listings. No scoring yet. This is the meaningful MVP.
1. **Scoring.** Add the Claude extract+score Edge Function, composite ranking,
   hard filters, scam flags. Dashboard shows scores + rationale.
2. **Manual editing.** Field corrections, score overrides, status workflow,
   notes, flag dismissal, re-score.
3. **Criteria editor + run controls.** In-app criteria; "collect now" (push
   channel via Supabase Realtime) + "score new"; run history.
4. **Polish.** PWA install (iPad/iPhone), responsive layout, web-push, `launchd`
   schedule, collector online/offline status, optional native menu-bar indicator.

---

## 13. What to reuse from the prototype

`hearth-local/` in the prototype repo already implements, and should be ported
rather than rebuilt:
- Persistent FB login + headed browser session handling.
- Multi-source collection (FB / Craigslist / Rentals.ca) with toggles.
- Craigslist host + subarea filtering; `location_allow`/`location_block` matched
  against text **and** URL slug.
- Clean content extraction (Craigslist exact selectors; main-region + tail-trim +
  og metadata for others; "See more" expansion).
- The `rentals.db` schema (`listings` / `scores` / `flagged`) and the scoring
  prompt design + scorer notes.

---

## 14. Decisions

All v1 build choices are settled — see **§0**. No open decisions remain for the
builder to make before starting; revisit photo re-hosting (§11) only if expired
links become a nuisance.
