-- rentals.db schema. Hearth creates this beside brain.db on first run:
--   sqlite3 "$DB_DIR/rentals.db" < team/hearth-scripts/rentals.sql
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,             -- 'fb_marketplace' | 'craigslist' | 'kijiji' | 'zumper' | 'manual'
  source_listing_id TEXT NOT NULL,  -- platform's native id
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,                  -- full free-text body
  price_monthly INTEGER,            -- CAD cents (avoid float)
  bedrooms INTEGER,
  bathrooms REAL,
  sqft INTEGER,                     -- nullable
  neighbourhood TEXT,
  address TEXT,                     -- nullable; many FBM/CL listings hide it
  lat REAL,
  lng REAL,
  posted_at TEXT,                   -- ISO 8601
  scraped_at TEXT NOT NULL,         -- ISO 8601
  photos_json TEXT,                 -- JSON array of photo URLs
  hard_filter_pass INTEGER NOT NULL DEFAULT 0,  -- 0/1
  composite_score REAL,             -- nullable until scored
  status TEXT NOT NULL DEFAULT 'new', -- 'new'|'shortlisted'|'contacted'|'viewed'|'rejected'|'dead'
  notes TEXT,                       -- Aidin's notes
  UNIQUE(source, source_listing_id)
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL,          -- matches a soft-filter name in rental-criteria.md
  score INTEGER NOT NULL,           -- 0–10
  rationale TEXT,                   -- 1-sentence justification
  scored_at TEXT NOT NULL,
  UNIQUE(listing_id, criterion)
);

CREATE TABLE IF NOT EXISTS flagged (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,             -- 'price_anomaly'|'stock_photos'|'broker_mill'|'wire_deposit'|'incomplete'|'other'
  detail TEXT,
  flagged_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_composite ON listings(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_listing ON scores(listing_id);
