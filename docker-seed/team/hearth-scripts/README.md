# Hearth scripts (deployed side)

- `rentals.sql` — schema for `rentals.db`. Hearth creates the DB beside
  `brain.db` on first run: `sqlite3 "$DB_DIR/rentals.db" < team/hearth-scripts/rentals.sql`.

Hearth runs as a persona (see `team/hearth.md`), not a standalone process. It
does Craigslist + scoring + reporting itself using Bash (`curl`, `sqlite3`) and
the `browser_fetch` tool.

## Facebook Marketplace input

FBM can't be scraped from the server (login + datacenter-IP blocks). Aidin runs
a small local collector on his own machine and drops its output file into
`team-inbox/`. Hearth ingests the newest `hearth-fbm-*.jsonl` / `.md` there.

The local collector lives in the repo at `hearth-local/` (`hearth_fbm.py`); its
README has the daily routine. Each JSONL row looks like:

```json
{"source":"fb_marketplace","source_listing_id":"123","url":"https://...","title":"2BR Kits","text":"<visible listing text>","photos":["https://..."],"captured_at":"2026-05-25T17:00:00Z"}
```

`text` is the raw visible listing text — Hearth parses price/beds/neighbourhood
and scores from it. After ingesting, move the file to `team-inbox/processed/`.
