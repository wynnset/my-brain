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

## 1. Goal & non-goals

**Goal:** one self-contained app that answers "what are the best 2BR rentals in
Vancouver for me right now?" — pulling from Facebook Marketplace, Craigslist,
and Rentals.ca, scoring each against weighted soft criteria, and letting the
user manage the search from any of their Apple devices.

**Non-goals (v1):**
- No multi-tenant / multi-user. Single user, single search profile.
- No automated landlord contact or messaging.
- No native iOS app (see §3 — not feasible for the Facebook part). PWA instead.
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
┌─────────────────────── USER'S MAC ───────────────────────┐
│ Collector agent (Python + Playwright, headed/persistent)  │
│  • logs into Facebook once, session persists locally      │
│  • scrapes FB Marketplace, Craigslist, Rentals.ca         │
│  • applies location / subarea filters                     │
│  • extracts clean listing content (not page chrome)       │
│  • POSTs new listings to the cloud API (bearer token)     │
│  • runs on demand and on a schedule (launchd)             │
└───────────────┬───────────────────────────────────────────┘
                │ HTTPS (auth: API token)
                ▼
┌──────────────────────── CLOUD ────────────────────────────┐
│ Backend API + DB + Scorer                                  │
│  • ingest endpoint: upsert listings (idempotent)           │
│  • scorer: for new listings, call Claude API →             │
│      structured fields + per-criterion scores + rationale  │
│  • hard-filter + scam-flag logic                           │
│  • CRUD for manual edits / status / overrides              │
│  • serves the web dashboard (static) + JSON API            │
└───────────────┬───────────────────────────────────────────┘
                │ HTTPS
                ▼
┌──────────── WEB DASHBOARD (PWA) ──────────────────────────┐
│ Mac / iPad / iPhone browser, installable to home screen    │
│  • ranked listings, filters, detail view, manual edits     │
└────────────────────────────────────────────────────────────┘
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
- Photo handling: either send photo URLs and let the server fetch/re-host, or the
  collector uploads images directly (signed URL). Decide per §11.

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
  exclusions). Failing → `hard_filter_pass=0`, not scored further (or scored but
  marked filtered — builder's choice; prototype drops them).
- **Composite** = Σ(score × weight) over soft criteria, computed server-side from
  the weights in `criteria` (so changing a weight re-ranks without re-calling
  the API). Respect `score_override` when present.
- **Scorer notes** (carried from the prototype's criteria doc): be conservative;
  if orientation/"bright" stated explicitly score high, if implied score mid with
  low confidence; "city view" facing towers is not "unobstructed"; don't invent
  facts (unmentioned criterion → 3–4 "not mentioned", not 0).
- **Rate / cost control**: batch ~5 at a time with a short delay; on HTTP 429
  back off and resume. Use an inexpensive-but-capable model for scoring; cost is
  ~cents per run for ~50 listings. Make the model configurable in settings.
- **Photos**: optionally include the cover image in the scoring call (vision) for
  better orientation/view/condition judgments; gate behind a setting since it
  costs more. Text-only is the default.

---

## 9. Triggering collection from the cloud

The dashboard's "Collect now" lives in the cloud, but only the Mac can scrape.
Options (pick one in the build):
- **Pull model (simplest):** the Mac collector polls a cloud endpoint
  (`GET /api/collect-requests`) every N minutes; the dashboard enqueues a
  request; the Mac picks it up, runs, and posts results. No inbound connection to
  the Mac needed.
- **Push model:** a persistent channel (WebSocket / SSE) from Mac → cloud that
  the cloud can signal. More immediate, more moving parts.
- **Schedule-only:** skip on-demand entirely; the Mac runs on a `launchd`
  schedule and the dashboard just shows whatever has synced.

Recommend **pull model + schedule** for v1 (no firewall/tunnel needed, Mac stays
behind NAT).

---

## 10. Tech stack (recommendations, not mandates)

**Collector:** keep **Python + Playwright** (reuse the prototype). Add an HTTP
client to push to the cloud and a small config file.

**Cloud backend + dashboard — two good paths:**
- **Path A — Supabase + a JS frontend (fastest to a polished app).** Postgres +
  built-in auth + storage (for photos) + row-level security + realtime updates;
  scoring runs in an Edge Function or a small worker calling Claude. Frontend in
  Next.js/React or SvelteKit, deployed on Vercel/Netlify. Realtime makes the
  dashboard feel live. Generous free tier.
- **Path B — single small server (closest to the existing prototype/infra).**
  Node (Express/Fastify) or Python (FastAPI) serving a JSON API + static SPA,
  SQLite + Litestream for backup (matches the pattern already in use), on Fly.io.
  Fewer services, you own all of it, but you build auth + realtime yourself.

**Recommendation:** **Path A (Supabase)** if you want the nicest cross-device app
with the least backend plumbing; **Path B** if you'd rather keep one small,
fully-owned server and reuse the SQLite/Litestream/Fly setup you already know.

**Auth:** single user — a strong password / magic link (Supabase) or one bearer
token + a simple login (Path B). The collector uses a separate long-lived token.

---

## 11. Cross-cutting concerns

- **Photos / FB CDN expiry:** FB `og:image` URLs may expire or require auth.
  Safest: collector downloads the cover image and uploads to cloud storage
  (Supabase Storage / S3-compatible); store the re-hosted URL in
  `cover_photo_url`. Otherwise photos may break in the dashboard later.
- **Cost control:** scoring is the only recurring cost. Score each listing once;
  re-score only on demand or when criteria change. Show a rough cost/usage in
  settings. Text-only scoring by default; vision optional.
- **Privacy:** listing data + your criteria live in the cloud (Path A or B). The
  FB session and login stay only on the Mac. No third party sees your FB account.
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

1. **DB + ingest + dashboard read.** Stand up the schema, the ingest endpoint,
   and a dashboard that lists synced listings (no scoring yet). Point the
   existing collector at the ingest endpoint.
2. **Scoring.** Add the Claude extract+score service, composite ranking, hard
   filters, scam flags. Dashboard shows scores + rationale.
3. **Manual editing.** Field corrections, score overrides, status workflow,
   notes, flag dismissal, re-score.
4. **Criteria editor + run controls.** In-app criteria; "collect now" (pull
   model) + "score new"; run history.
5. **Polish.** PWA install, responsive layout, photo re-hosting, optional
   web-push, optional vision scoring, schedule.

A read-only synced dashboard (phase 1–2) is the meaningful MVP.

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

## 14. Open decisions for the builder

- Stack: **Supabase/JS** vs **single FastAPI/Node + SQLite/Fly** (see §10).
- Collection trigger: pull-poll vs schedule-only for v1 (§9).
- Photos: re-host vs hotlink (§11).
- Scoring model + whether to enable vision (§8).
- How aggressively to apply hard filters (drop vs keep-and-mark).
