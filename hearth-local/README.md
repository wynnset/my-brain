# Hearth — local Facebook Marketplace collector

This is the **local half** of Hearth, your rental scout. It runs on *your*
machine because Facebook Marketplace needs a real, logged-in browser session and
blocks servers. It collects FBM listings into one file. You drag that file into
your Cyrus workspace, and **Hearth on the deployed side** does the rest:
scrapes Craigslist itself, ingests your FBM file, scores everything against
`docs/rental-criteria.md`, saves to `rentals.db`, and writes the report.

```
  YOUR MACHINE                          DEPLOYED (Cyrus / Hearth)
  ────────────                          ─────────────────────────
  python hearth_fbm.py run              scrapes Craigslist (RSS)
        │  writes out/hearth-fbm-*.md          │
        └──── drag file into ─────────►  team-inbox/  ──► ingests + dedupes
                                                          scores (LLM)
                                                          writes rentals.db
                                                          owners-inbox/hearth-report-[date].md
```

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

**Edit `config.json`:** open Facebook Marketplace in your browser, set the
category to *Property Rentals*, your location + radius, price range, and 2+
bedrooms. Copy that result-page URL into `search_urls`. Add as many search URLs
as you want. Your login is saved in `.fb-profile/` so you only log in once
(re-run `login` if Facebook logs you out).

## Every day (the whole routine)

```bash
cd hearth-local
. .venv/bin/activate          # Windows: .venv\Scripts\activate
python hearth_fbm.py run
```

A browser opens, scrolls your searches, and saves new listings to
`out/hearth-fbm-YYYY-MM-DD.md` (and a `.jsonl` twin). It remembers what it has
already seen, so each run only adds new listings.

Then:
1. Open your Cyrus workspace.
2. Drag `out/hearth-fbm-YYYY-MM-DD.md` into **team-inbox** (or attach it in chat).
3. Say **"find rentals"**.

Hearth ingests your FBM file, pulls fresh Craigslist listings, scores them all,
and posts the ranked report (also saved to `owners-inbox/hearth-report-[date].md`).

### Capture a single listing by hand

If you spot one Facebook listing you want included (or the auto-scan missed it):

```bash
python hearth_fbm.py add "https://www.facebook.com/marketplace/item/1234567890/"
```

It appends to today's output file just like a normal run.

## What this tool does and doesn't do

- **Does:** log into FB (your session), scan your saved searches, capture each
  new listing's URL + visible text + cover photo, dedupe across days, write one
  tidy file.
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
- Craigslist is handled entirely by the deployed Hearth (RSS), not here.

## Why not `ai-marketplace-monitor`?

The original spec planned to use the `ai-marketplace-monitor` PyPI tool. On
review it only supports Facebook (not Craigslist) and only emits
notifications (PushBullet / Telegram / email) — there's no clean file or DB
export to hand to Hearth. This focused collector produces exactly the file the
deployed Hearth needs, with far less to install and maintain. If you ever want
its AI pre-filtering, you can still run it alongside and use
`hearth_fbm.py add <url>` to pull its picks into the file.
