# Hearth — local rental collector

This is the **local half** of Hearth, your rental scout. It runs on *your*
machine because Facebook needs a real logged-in browser, and Craigslist blocks
the deployed server's datacenter IP — both work fine from home. It collects
listings from several sources into one file. You drag that file into your Cyrus
workspace, and **Hearth on the deployed side** scores everything against
`docs/rental-criteria.md`, saves to `rentals.db`, and writes the report.

Sources (toggle each in `config.json`):
- **Facebook Marketplace** — browser, your login
- **Craigslist** — scraped through the browser (it 403s plain HTTP/RSS clients *and* the server's IP)
- **Rentals.ca** — browser (works well)
- **PadMapper / Zumper** — browser, best-effort (map SPAs with anti-bot; off by default)

```
  YOUR MACHINE                          DEPLOYED (Cyrus / Hearth)
  ────────────                          ─────────────────────────
  python hearth_fbm.py run              ───drag file──►  team-inbox/
    FB + Craigslist + Rentals.ca ...                       │
    writes out/hearth-listings-*.md                        ▼
                                              ingests + dedupes, scores (LLM),
                                              writes rentals.db,
                                              owners-inbox/hearth-report-[date].md
```

> Upgrading from the first version? Your `config.json` needs the new
> `location_allow`, `location_block`, `craigslist`, and `sites` keys — easiest
> is `cp config.example.json config.json` again and re-paste your FB search URL.

## One-time setup

You need Python 3.9+.

```bash
# macOS / Linux
cd hearth-local
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp config.example.json config.json      # then edit config.json (see below)
python hearth_fbm.py login               # opens a browser — log into Facebook, then close it
```

```powershell
# Windows (PowerShell)
cd hearth-local
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
copy config.example.json config.json     # then edit config.json
python hearth_fbm.py login
```

**Edit `config.json`:**
- **Facebook `search_urls`:** open Marketplace in your browser, set **Location =
  Vancouver with a radius** (e.g. 20 km), category = *Property Rentals*, price,
  and 2+ beds, then copy that result-page URL. **Don't use a bare `?query=`
  search** — those ignore location and are why you saw listings from all over.
- **`location_allow` / `location_block`:** the safety net. Any listing whose text
  doesn't mention an allowed area (or that mentions a blocked one) is dropped
  from *every* source. Tune these lists to your real target neighbourhoods.
- **`craigslist`:** set `min_price` / `max_price` / `min_bedrooms`. Two filters
  keep results local: (1) only listings on your `site` (e.g.
  `vancouver.craigslist.org`) are kept — drops "nearby areas" links to other
  cities; (2) **`subareas`** restricts to parts of that site. The vancouver site
  splits the Lower Mainland into subareas you can read off any listing URL
  (`vancouver.craigslist.org/<code>/apa/…`): `van` = city of Vancouver, `bnc` =
  Burnaby/New West, `nvn` = north shore, `rds` = richmond/delta, `pml` =
  tri-cities. Ships as `["van"]` (Vancouver proper); use `[]` for all, or add
  codes. (`search_distance`+`postal` or your own pasted `search_urls` are
  alternative radius controls.)
- **`sites`:** Rentals.ca is on by default; PadMapper/Zumper are off (turn on
  once you've eyeballed the output).

Your FB login is saved in `.fb-profile/`, so you only log in once (re-run
`login` if Facebook logs you out).

## Every day (the whole routine)

```bash
cd hearth-local
. .venv/bin/activate          # Windows: .venv\Scripts\activate
python hearth_fbm.py run
```

A browser opens and collects Craigslist, Facebook, and any enabled sites,
saving new listings to `out/hearth-listings-YYYY-MM-DD.md` (and a `.jsonl`
twin). Each source prints a count like `12 new, 3 skipped (out of area)`. It
remembers what it has already seen, so runs only add new listings.

Then:
1. Open your Cyrus workspace.
2. Drag `out/hearth-listings-YYYY-MM-DD.md` into **team-inbox** (or attach it in chat).
3. Say **"find rentals"**.

Hearth ingests the file, dedupes, scores everything, and posts the ranked report
(also saved to `owners-inbox/hearth-report-[date].md`).

### Capture a single listing by hand

If you spot one listing you want included (any site) or the auto-scan missed it:

```bash
python hearth_fbm.py add "https://www.facebook.com/marketplace/item/1234567890/"
```

It appends to today's output file just like a normal run.

## What this tool does and doesn't do

- **Does:** log into FB (your session), scan your saved searches, and capture
  each new listing's **main content** — the description/details, not the page
  header, footer, nav or "more like this" rails — plus the URL and cover photo.
  Craigslist is read from its exact post fields (`#postingbody` etc.); other
  sites use the main content region with the suggested-listings tail trimmed.
- **Doesn't:** score listings, apply your soft criteria, or judge scams — that
  all happens on the deployed Hearth side where the LLM and `rentals.db` live.
  Keeping scoring in one place means your criteria only live in one document
  (`docs/rental-criteria.md`) and you don't need a local API key.

## Known limitations

- Facebook changes its page markup often. The collector is built to survive that
  (it grabs the whole visible text rather than specific fields), but if a *run*
  finds zero links, Facebook may have logged you out — re-run
  `python hearth_fbm.py login`.
- Facebook may show a checkpoint/CAPTCHA. Because the browser is visible
  (`headless: false`), just solve it in the window; the run continues.
- This is for personal use at human pace. Don't crank `max_scrolls` high or run
  it in a tight loop — that's how sessions get flagged.
- **Location filter trade-off:** it keeps a listing only if its text mentions an
  allowed area. If a real listing omits the city name in its body it can be
  skipped — watch the `skipped (out of area)` counts and widen `location_allow`
  if it's too aggressive. Set `location_allow` to `[]` to turn it off.
- **PadMapper / Zumper** are map-based single-page apps with anti-bot defences;
  the generic harvester may collect few or no links from them. If a site returns
  nothing, leave it off and use `add <url>` for individual finds, or tune its
  `link_pattern`. Rentals.ca behaves like a normal listings site and works well.

## Why not `ai-marketplace-monitor`?

The original spec planned to use the `ai-marketplace-monitor` PyPI tool. On
review it only supports Facebook (not Craigslist) and only emits
notifications (PushBullet / Telegram / email) — there's no clean file or DB
export to hand to Hearth. This focused collector produces exactly the file the
deployed Hearth needs, with far less to install and maintain. If you ever want
its AI pre-filtering, you can still run it alongside and use
`hearth_fbm.py add <url>` to pull its picks into the file.
