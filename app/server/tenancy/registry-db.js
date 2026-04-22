'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/** Default USD limits applied to every new tenant (see issue: $10 daily / $10 monthly). */
const DEFAULT_DAILY_LIMIT_USD = 10;
const DEFAULT_MONTHLY_LIMIT_USD = 10;

function resolveRegistrySqlPath() {
  const candidates = [
    // Baked into the image (Dockerfile: COPY docker-seed/registry.sql ./data/registry.sql → /app/data/…)
    path.join(__dirname, '..', '..', 'data', 'registry.sql'),
    // Local dev: repo `data/registry.sql` (same layout as server.js default DB_DIR)
    path.join(__dirname, '..', '..', '..', 'data', 'registry.sql'),
    // Local dev: repo `docker-seed/registry.sql` (not under /app in Fly; avoids resolving to /docker-seed)
    path.join(__dirname, '..', '..', '..', 'docker-seed', 'registry.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`registry.sql not found (tried ${candidates.join(', ')})`);
}

/**
 * Apply additive migrations that cannot live in the idempotent `.sql` file
 * (ALTER TABLE in SQLite is not guarded by IF NOT EXISTS). Safe to call on
 * every boot.
 * @param {import('better-sqlite3').Database} db
 */
function applyRegistryJsMigrations(db) {
  const userCols = new Set(db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name));
  if (!userCols.has('daily_limit_usd')) {
    db.exec(`ALTER TABLE users ADD COLUMN daily_limit_usd REAL NOT NULL DEFAULT ${DEFAULT_DAILY_LIMIT_USD}`);
  }
  if (!userCols.has('monthly_limit_usd')) {
    db.exec(`ALTER TABLE users ADD COLUMN monthly_limit_usd REAL NOT NULL DEFAULT ${DEFAULT_MONTHLY_LIMIT_USD}`);
  }
  // user_usage_history may pre-exist on old registries that ran the SQL file
  // before we added this table; CREATE IF NOT EXISTS on the SQL file handles
  // the common case, but keep a guard here so callers that migrate a hand-
  // rolled registry still pick it up.
  db.exec(`CREATE TABLE IF NOT EXISTS user_usage_history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    spend_usd REAL NOT NULL DEFAULT 0,
    closed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (user_id, period_start)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_user_usage_history_user_start
    ON user_usage_history(user_id, period_start DESC)`);
}

function ensureRegistrySchema(registryPath) {
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sqlPath = resolveRegistrySqlPath();
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const db = new Database(registryPath);
  try {
    db.exec(sql);
    applyRegistryJsMigrations(db);
  } finally {
    db.close();
  }
}

function openRegistryReadWrite(registryPath) {
  return new Database(registryPath);
}

/** @param {import('better-sqlite3').Database} db */
function findUserByLogin(db, login) {
  const row = db
    .prepare('SELECT id, login, password_hash, api_token, display_name FROM users WHERE login = ? COLLATE NOCASE')
    .get(String(login || '').trim());
  return row || null;
}

/** @param {import('better-sqlite3').Database} db */
function findUserByApiToken(db, token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return db.prepare('SELECT id, login, password_hash, api_token, display_name FROM users WHERE api_token = ?').get(t) || null;
}

/** Login + display name for dashboard (no secrets). */
function findUserSessionSummary(db, id) {
  const row = db.prepare('SELECT login, display_name FROM users WHERE id = ?').get(String(id || '').trim());
  return row || null;
}

// ─── Usage / credit-limit helpers ────────────────────────────────────────────
//
// Tracking lives in `registry.db` (under the server volume) — never inside the
// per-tenant data dir — so agents and end users cannot tamper with their own
// counters. The chat route reads a snapshot before accepting a new message and
// increments the counters after each turn's billing lands.

/** @param {Date} d */
function utcDayKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First moment of the NEXT UTC day. */
function nextUtcDayResetIso(d) {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
  return next.toISOString();
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Compute the start (inclusive) of the monthly billing cycle that contains
 * `now`, anchored to `createdAt`'s day-of-month. If that day-of-month does not
 * exist in the current month (e.g. Feb has no 31st) the cycle starts on the
 * last day of the month instead.
 * @param {Date} createdAt
 * @param {Date} now
 * @returns {Date} UTC midnight of the cycle-start date
 */
function monthPeriodStartFor(createdAt, now) {
  const anchorDay = createdAt.getUTCDate();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  const clampDay = (yy, mm) => Math.min(anchorDay, daysInUtcMonth(yy, mm));
  let candidate = new Date(Date.UTC(y, m, clampDay(y, m), 0, 0, 0, 0));
  if (candidate.getTime() > now.getTime()) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
    candidate = new Date(Date.UTC(y, m, clampDay(y, m), 0, 0, 0, 0));
  }
  return candidate;
}

/**
 * Start of the NEXT cycle after `currentStart`, honouring the same anchor rule.
 * @param {Date} currentStart
 * @param {Date} createdAt
 * @returns {Date}
 */
function nextMonthPeriodStart(currentStart, createdAt) {
  const anchorDay = createdAt.getUTCDate();
  let y = currentStart.getUTCFullYear();
  let m = currentStart.getUTCMonth() + 1;
  if (m > 11) { m = 0; y += 1; }
  const day = Math.min(anchorDay, daysInUtcMonth(y, m));
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
}

/** Parse a registry timestamp (ISO-8601 or SQLite CURRENT_TIMESTAMP). */
function parseDbTimestamp(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC, no 'T'/'Z').
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + (/Z|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z');
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** @param {import('better-sqlite3').Database} db */
function loadUserForUsage(db, userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  return db
    .prepare(
      'SELECT id, created_at, daily_limit_usd, monthly_limit_usd FROM users WHERE id = ?',
    )
    .get(id) || null;
}

/** @param {import('better-sqlite3').Database} db */
function loadUsageRow(db, userId) {
  return (
    db.prepare('SELECT user_id, day_key, day_spend_usd, month_period_start, month_spend_usd FROM user_usage WHERE user_id = ?')
      .get(String(userId)) || null
  );
}

/**
 * Create (or reset) the usage row to reflect `now`'s day + month cycle, with
 * zeroed counters. Closed monthly cycles are archived into
 * `user_usage_history` (transactional with the reset) so previous months are
 * never lost on rollover. Already-aligned rows are returned unchanged.
 * @param {import('better-sqlite3').Database} db
 * @param {{ id: string, created_at: string }} userRow
 * @param {Date} now
 */
function ensureUsageRowAligned(db, userRow, now) {
  const createdAt = parseDbTimestamp(userRow.created_at) || now;
  const dayKey = utcDayKey(now);
  const monthStart = utcDayKey(monthPeriodStartFor(createdAt, now));
  const existing = loadUsageRow(db, userRow.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO user_usage (user_id, day_key, day_spend_usd, month_period_start, month_spend_usd, updated_at)
       VALUES (?, ?, 0, ?, 0, CURRENT_TIMESTAMP)`,
    ).run(userRow.id, dayKey, monthStart);
    return { day_key: dayKey, day_spend_usd: 0, month_period_start: monthStart, month_spend_usd: 0 };
  }
  let { day_key, day_spend_usd, month_period_start, month_spend_usd } = existing;
  const dayChanged = day_key !== dayKey;
  const monthChanged = month_period_start !== monthStart;
  if (!dayChanged && !monthChanged) {
    return { day_key, day_spend_usd, month_period_start, month_spend_usd };
  }

  // Build the new values + any history insert, then apply in a single txn so
  // we can never zero the live counter without archiving the previous cycle.
  const oldMonthStart = month_period_start;
  const oldMonthSpend = Number(month_spend_usd) || 0;
  const applyRollover = db.transaction(() => {
    if (monthChanged) {
      // Archive the cycle we are leaving. `INSERT OR IGNORE` keeps an existing
      // (manually-edited?) history row rather than silently overwriting it.
      const oldCreatedAt = createdAt; // anchor is stable, so fine to reuse here
      const oldStartDate = parseDbTimestamp(oldMonthStart + 'T00:00:00Z') || now;
      const oldEnd = utcDayKey(nextMonthPeriodStart(oldStartDate, oldCreatedAt));
      db.prepare(
        `INSERT OR IGNORE INTO user_usage_history (user_id, period_start, period_end, spend_usd, closed_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(userRow.id, oldMonthStart, oldEnd, oldMonthSpend);
      month_period_start = monthStart;
      month_spend_usd = 0;
    }
    if (dayChanged) {
      day_key = dayKey;
      day_spend_usd = 0;
    }
    db.prepare(
      `UPDATE user_usage
         SET day_key = ?, day_spend_usd = ?, month_period_start = ?, month_spend_usd = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
    ).run(day_key, day_spend_usd, month_period_start, month_spend_usd, userRow.id);
  });
  applyRollover();
  return { day_key, day_spend_usd, month_period_start, month_spend_usd };
}

/**
 * Return the most recent N closed monthly cycles for a user, newest first.
 * Useful for dashboards that want to show a trailing-12-months bar chart or
 * answer "what did I spend last month?". Does NOT include the in-progress
 * cycle — that lives on `user_usage` and comes back via `getUsageSnapshot`.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {number} [limit=12]
 */
function listRecentMonthlyUsage(db, userId, limit = 12) {
  const n = Math.max(1, Math.min(120, Number(limit) || 12));
  const rows = db
    .prepare(
      `SELECT period_start, period_end, spend_usd, closed_at
         FROM user_usage_history
         WHERE user_id = ?
         ORDER BY period_start DESC
         LIMIT ?`,
    )
    .all(String(userId), n);
  return rows.map((r) => ({
    periodStart: String(r.period_start),
    periodEnd: String(r.period_end),
    spendUsd: Number(r.spend_usd) || 0,
    closedAt: r.closed_at != null ? String(r.closed_at) : null,
  }));
}

/**
 * Return the current limits + spending snapshot, applying any day/month
 * rollovers as a side effect. Safe to call on every request. When
 * `opts.monthHistoryLimit > 0` the returned snapshot also carries a
 * `monthHistory` array (most recent cycles first), read from
 * `user_usage_history`.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {Date} [now]
 * @param {{ monthHistoryLimit?: number }} [opts]
 */
function getUsageSnapshot(db, userId, now = new Date(), opts = {}) {
  const user = loadUserForUsage(db, userId);
  if (!user) return null;
  const createdAt = parseDbTimestamp(user.created_at) || now;
  const aligned = ensureUsageRowAligned(db, user, now);
  const currentMonthStart = parseDbTimestamp(aligned.month_period_start + 'T00:00:00Z') || now;
  const dailyLimitUsd = Number(user.daily_limit_usd);
  const monthlyLimitUsd = Number(user.monthly_limit_usd);
  const daySpendUsd = Number(aligned.day_spend_usd) || 0;
  const monthSpendUsd = Number(aligned.month_spend_usd) || 0;
  const snap = {
    userId: user.id,
    createdAt: createdAt.toISOString(),
    dailyLimitUsd: Number.isFinite(dailyLimitUsd) ? dailyLimitUsd : DEFAULT_DAILY_LIMIT_USD,
    monthlyLimitUsd: Number.isFinite(monthlyLimitUsd) ? monthlyLimitUsd : DEFAULT_MONTHLY_LIMIT_USD,
    daySpendUsd,
    monthSpendUsd,
    dayKey: aligned.day_key,
    monthPeriodStart: aligned.month_period_start,
    dayResetsAt: nextUtcDayResetIso(now),
    monthResetsAt: nextMonthPeriodStart(currentMonthStart, createdAt).toISOString(),
  };
  const histLimit = Number(opts && opts.monthHistoryLimit);
  if (Number.isFinite(histLimit) && histLimit > 0) {
    snap.monthHistory = listRecentMonthlyUsage(db, user.id, histLimit);
  }
  return snap;
}

/**
 * Determine whether the user is out of credits (either limit).
 * @param {ReturnType<typeof getUsageSnapshot> | null} snap
 * @returns {{ exceeded: boolean, kind?: 'daily' | 'monthly', resetsAt?: string }}
 */
function limitState(snap) {
  if (!snap) return { exceeded: false };
  // Monthly trumps daily: even if today still has room, a blown month blocks.
  if (snap.monthlyLimitUsd > 0 && snap.monthSpendUsd >= snap.monthlyLimitUsd) {
    return { exceeded: true, kind: 'monthly', resetsAt: snap.monthResetsAt };
  }
  if (snap.dailyLimitUsd > 0 && snap.daySpendUsd >= snap.dailyLimitUsd) {
    return { exceeded: true, kind: 'daily', resetsAt: snap.dayResetsAt };
  }
  return { exceeded: false };
}

/**
 * Record an additional spend against a user's counters. Applies any pending
 * day/month rollovers first. Zero/negative/NaN is ignored.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {number} usd
 * @param {Date} [now]
 */
function addUsage(db, userId, usd, now = new Date()) {
  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const user = loadUserForUsage(db, userId);
  if (!user) return null;
  ensureUsageRowAligned(db, user, now);
  db.prepare(
    `UPDATE user_usage
       SET day_spend_usd = day_spend_usd + ?,
           month_spend_usd = month_spend_usd + ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE user_id = ?`,
  ).run(amount, amount, userId);
  return getUsageSnapshot(db, userId, now);
}

/**
 * Update one or both limits for a user (admin path). Null/undefined leaves the
 * existing value in place. Returns the fresh snapshot.
 */
function setUserLimits(db, userId, { dailyLimitUsd, monthlyLimitUsd } = {}) {
  const user = loadUserForUsage(db, userId);
  if (!user) return null;
  const sets = [];
  const args = [];
  if (dailyLimitUsd != null && Number.isFinite(Number(dailyLimitUsd))) {
    sets.push('daily_limit_usd = ?');
    args.push(Number(dailyLimitUsd));
  }
  if (monthlyLimitUsd != null && Number.isFinite(Number(monthlyLimitUsd))) {
    sets.push('monthly_limit_usd = ?');
    args.push(Number(monthlyLimitUsd));
  }
  if (sets.length) {
    args.push(userId);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }
  return getUsageSnapshot(db, userId);
}

module.exports = {
  DEFAULT_DAILY_LIMIT_USD,
  DEFAULT_MONTHLY_LIMIT_USD,
  ensureRegistrySchema,
  openRegistryReadWrite,
  findUserByLogin,
  findUserByApiToken,
  findUserSessionSummary,
  getUsageSnapshot,
  listRecentMonthlyUsage,
  limitState,
  addUsage,
  setUserLimits,
  // Exported for targeted tests / scripts.
  utcDayKey,
  monthPeriodStartFor,
  nextMonthPeriodStart,
};
