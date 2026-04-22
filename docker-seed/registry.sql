-- Registry for multi-user mode (lives at TENANT_VOLUME_ROOT/registry.db)
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  api_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);

-- Per-user spend caps (USD) enforced by the chat route. Columns are added to
-- existing registries via the JS migration in app/server/tenancy/registry-db.js
-- (ALTER TABLE is not idempotent in raw SQL). New installs pick them up here.
CREATE TABLE IF NOT EXISTS user_usage (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- UTC day (YYYY-MM-DD) the `day_spend_usd` counter belongs to.
  day_key TEXT NOT NULL,
  day_spend_usd REAL NOT NULL DEFAULT 0,
  -- UTC date (YYYY-MM-DD) marking the start of the user's current monthly
  -- billing cycle. Anchor day-of-month = account creation day; clamped to the
  -- last day of shorter months (e.g. Jan 31 → Feb 28/29 → Mar 31).
  month_period_start TEXT NOT NULL,
  month_spend_usd REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Archive of closed monthly cycles. Written on rollover inside
-- ensureUsageRowAligned (registry-db.js). `period_end` is exclusive (= the
-- start of the next cycle) so callers can render "Apr 22 → May 22" windows
-- without re-running the anchor math.
CREATE TABLE IF NOT EXISTS user_usage_history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  spend_usd REAL NOT NULL DEFAULT 0,
  closed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  PRIMARY KEY (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_user_usage_history_user_start
  ON user_usage_history(user_id, period_start DESC);
