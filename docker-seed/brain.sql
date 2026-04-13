-- ============================================================
-- BRAIN.DB — Shared action item store
-- Cross-domain todo tracking for all agents
-- Sole writer: Ledger. Sole reader for consolidated view: Dash.
-- ============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- ACTION ITEMS
-- ============================================================

CREATE TABLE action_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    domain            TEXT NOT NULL CHECK (domain IN ('career', 'finance', 'business', 'personal', 'family')),
    source_agent      TEXT NOT NULL,    -- always 'ledger'; source_ref preserves origin agent
    title             TEXT NOT NULL,
    description       TEXT,
    due_date          DATE,
    priority          TEXT DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
    status            TEXT DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
    recurrence        TEXT DEFAULT 'none' CHECK (recurrence IN ('none', 'biweekly', 'monthly', 'quarterly', 'annual')),
    snoozed_until     DATE,             -- defer visibility without dismissing
    effort_hours      REAL,             -- estimated hours to complete (can be fractional, e.g. 0.25)
    urgency           TEXT DEFAULT 'medium' CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
    source_ref        TEXT,             -- originating record, e.g. 'compliance_event:42'
    resolution_notes  TEXT,             -- how the item was resolved (set when marking done/dismissed)
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at      DATETIME
);

-- Auto-update updated_at on any change
CREATE TRIGGER trg_action_items_updated_at
AFTER UPDATE ON action_items
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at
BEGIN
    UPDATE action_items SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- ============================================================
-- VIEWS
-- All views exclude snoozed items (snoozed_until > today)
-- ============================================================

-- All open, non-snoozed items ordered by priority then due date
CREATE VIEW v_open_action_items AS
SELECT
    id,
    domain,
    urgency,
    priority,
    effort_hours,
    title,
    description,
    due_date,
    snoozed_until,
    recurrence,
    source_agent,
    source_ref,
    created_at
FROM action_items
WHERE status = 'open'
  AND (snoozed_until IS NULL OR snoozed_until <= DATE('now'))
ORDER BY
    CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    due_date ASC NULLS LAST,
    created_at ASC;

-- Overdue open items only
CREATE VIEW v_overdue_items AS
SELECT
    id,
    domain,
    priority,
    title,
    description,
    due_date,
    source_agent
FROM action_items
WHERE status = 'open'
  AND due_date < DATE('now')
  AND (snoozed_until IS NULL OR snoozed_until <= DATE('now'))
ORDER BY due_date ASC;

-- Summary by domain: counts for dashboard/brief use
CREATE VIEW v_items_by_domain AS
SELECT
    domain,
    COUNT(*) AS total,
    COUNT(CASE WHEN priority = 'high' THEN 1 END) AS high_priority,
    COUNT(CASE WHEN due_date < DATE('now') THEN 1 END) AS overdue,
    COUNT(CASE WHEN due_date <= DATE('now', '+7 days') AND due_date >= DATE('now') THEN 1 END) AS due_this_week
FROM action_items
WHERE status = 'open'
  AND (snoozed_until IS NULL OR snoozed_until <= DATE('now'))
GROUP BY domain;
