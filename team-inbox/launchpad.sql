-- ============================================================
-- LAUNCHPAD TRACKER DATABASE
-- Career transition tracking for the 8-week blueprint
-- ============================================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- WEEKLY PLANNING & TASK MANAGEMENT
-- ============================================================

-- Weekly plans with goals and time budget
CREATE TABLE weeks (
    week_number     INTEGER PRIMARY KEY,
    title           TEXT NOT NULL,
    theme           TEXT,
    start_date      DATE,
    end_date        DATE,
    hours_budget    REAL DEFAULT 15.0,
    hours_actual    REAL DEFAULT 0.0,
    status          TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'complete')),
    retro_notes     TEXT,  -- end-of-week reflection
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Weekly goals (the checkbox items from the blueprint)
CREATE TABLE weekly_goals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    week_number     INTEGER NOT NULL REFERENCES weeks(week_number),
    goal            TEXT NOT NULL,
    is_met          INTEGER DEFAULT 0,  -- 0 = not met, 1 = met
    notes           TEXT
);

-- Tasks: the core unit of work
CREATE TABLE tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    week_number     INTEGER NOT NULL REFERENCES weeks(week_number),
    lane            TEXT NOT NULL CHECK (lane IN ('job_search', 'consulting', 'network_content', 'admin')),
    title           TEXT NOT NULL,
    description     TEXT,
    hours_estimated REAL,
    hours_actual    REAL DEFAULT 0.0,
    status          TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')),
    due_date        DATE,
    completed_at    DATETIME,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- JOB SEARCH PIPELINE (Lane 1)
-- ============================================================

-- Companies you're tracking
CREATE TABLE companies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    website         TEXT,
    industry        TEXT,
    size            TEXT,  -- e.g. 'startup', 'mid', 'enterprise'
    location        TEXT,
    remote_policy   TEXT CHECK (remote_policy IN ('onsite', 'hybrid', 'remote', 'unknown')),
    tech_stack      TEXT,  -- comma-separated or free text
    notes           TEXT,
    source          TEXT,  -- where you found them: 'linkedin', 'builtinvancouver', 'referral', etc.
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Job applications
CREATE TABLE applications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      INTEGER NOT NULL REFERENCES companies(id),
    role_title      TEXT NOT NULL,
    role_type       TEXT DEFAULT 'full_time' CHECK (role_type IN ('full_time', 'contract', 'fractional', 'freelance')),
    posting_url     TEXT,
    salary_range    TEXT,  -- e.g. '$120K-$150K' or '$120-$150/hr'
    applied_date    DATE,
    status          TEXT DEFAULT 'researching' CHECK (status IN (
                        'researching', 'applied', 'responded', 'phone_screen',
                        'interview_1', 'interview_2', 'interview_final',
                        'offer', 'accepted', 'rejected', 'withdrawn', 'ghosted'
                    )),
    status_updated  DATETIME,
    cover_letter    INTEGER DEFAULT 0,  -- 1 = sent tailored cover letter
    referral_from   TEXT,  -- name of person who referred you, if any
    next_step       TEXT,
    next_step_date  DATE,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Interview tracking (linked to applications)
CREATE TABLE interviews (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL REFERENCES applications(id),
    round           TEXT NOT NULL,  -- 'phone_screen', 'technical', 'product_case', 'culture', 'final'
    scheduled_at    DATETIME,
    interviewer     TEXT,
    format          TEXT CHECK (format IN ('phone', 'video', 'onsite')),
    prep_notes      TEXT,  -- what to prepare
    outcome         TEXT CHECK (outcome IN ('passed', 'failed', 'pending', 'cancelled')),
    feedback        TEXT,  -- what they said / what you learned
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- NETWORKING & OUTREACH
-- ============================================================

-- People in your network
CREATE TABLE contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    company         TEXT,
    role            TEXT,
    relationship    TEXT,  -- 'sfu', 'ubc', 'nextgen', 'recruiter', 'ash_intro', 'community', 'cold'
    email           TEXT,
    linkedin_url    TEXT,
    phone           TEXT,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Every outreach message and follow-up
CREATE TABLE outreach (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id      INTEGER NOT NULL REFERENCES contacts(id),
    direction       TEXT DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
    channel         TEXT CHECK (channel IN ('email', 'linkedin', 'slack', 'text', 'phone', 'in_person', 'other')),
    purpose         TEXT CHECK (purpose IN (
                        'reconnect', 'coffee_chat', 'ask_for_intro',
                        'recruiter_outreach', 'follow_up', 'thank_you',
                        'consulting_pitch', 'general'
                    )),
    message_summary TEXT,  -- brief note on what you said
    sent_date       DATE,
    response_date   DATE,
    response_status TEXT DEFAULT 'pending' CHECK (response_status IN ('pending', 'replied', 'no_reply', 'meeting_booked')),
    next_action     TEXT,
    next_action_date DATE,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Coffee chats and meetings
CREATE TABLE meetings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id      INTEGER REFERENCES contacts(id),
    meeting_type    TEXT CHECK (meeting_type IN ('coffee_chat', 'interview', 'consulting_call', 'meetup', 'other')),
    scheduled_at    DATETIME,
    duration_min    INTEGER,
    location        TEXT,  -- 'zoom', 'phone', cafe name, etc.
    agenda          TEXT,
    outcome         TEXT,  -- what came out of it
    follow_up       TEXT,  -- what you need to do next
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- CONSULTING PIPELINE (Lane 2)
-- ============================================================

CREATE TABLE consulting_leads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id      INTEGER REFERENCES contacts(id),
    company         TEXT,
    service_type    TEXT,  -- 'firebase_review', 'product_strategy', 'fractional_cpo', 'architecture', 'workshop'
    description     TEXT,
    estimated_value REAL,  -- dollar amount
    hourly_rate     REAL,
    status          TEXT DEFAULT 'lead' CHECK (status IN (
                        'lead', 'conversation', 'proposal_sent',
                        'negotiating', 'won', 'lost', 'on_hold'
                    )),
    proposal_sent_date DATE,
    closed_date     DATE,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Invoices for consulting work
CREATE TABLE invoices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER REFERENCES consulting_leads(id),
    invoice_number  TEXT,
    amount          REAL NOT NULL,
    hours_billed    REAL,
    issued_date     DATE,
    due_date        DATE,
    paid_date       DATE,
    status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- CONTENT & VISIBILITY (Lane 3)
-- ============================================================

CREATE TABLE content (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content_type    TEXT NOT NULL CHECK (content_type IN (
                        'blog_post', 'linkedin_post', 'linkedin_article',
                        'community_answer', 'talk', 'case_study', 'other'
                    )),
    title           TEXT NOT NULL,
    platform        TEXT,  -- 'dev.to', 'medium', 'linkedin', 'reddit', etc.
    url             TEXT,
    status          TEXT DEFAULT 'idea' CHECK (status IN ('idea', 'outlined', 'drafting', 'published')),
    published_date  DATE,
    views           INTEGER,
    engagement      INTEGER,  -- likes + comments + shares
    leads_generated INTEGER DEFAULT 0,  -- did anyone reach out because of this?
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Communities you've joined and engagement tracking
CREATE TABLE communities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    platform        TEXT,  -- 'slack', 'discord', 'reddit', 'google_group', 'meetup'
    url             TEXT,
    joined_date     DATE,
    last_active     DATE,
    contributions   INTEGER DEFAULT 0,  -- questions answered, posts made
    notes           TEXT
);

-- ============================================================
-- FINANCIAL TRACKING
-- ============================================================

CREATE TABLE income (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL CHECK (source IN (
                        'salary', 'contract', 'consulting', 'digital_product',
                        'nextgen_backpay', 'ei', 'other'
                    )),
    description     TEXT,
    amount          REAL NOT NULL,
    date_received   DATE,
    invoice_id      INTEGER REFERENCES invoices(id),  -- link to consulting invoice if applicable
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Weekly dashboard: how am I doing this week?
CREATE VIEW v_weekly_dashboard AS
SELECT
    w.week_number,
    w.title,
    w.hours_budget,
    COALESCE(SUM(t.hours_actual), 0) AS hours_used,
    COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS tasks_done,
    COUNT(CASE WHEN t.status IN ('todo', 'in_progress') THEN 1 END) AS tasks_remaining,
    (SELECT COUNT(*) FROM weekly_goals g WHERE g.week_number = w.week_number AND g.is_met = 1) AS goals_met,
    (SELECT COUNT(*) FROM weekly_goals g WHERE g.week_number = w.week_number) AS goals_total
FROM weeks w
LEFT JOIN tasks t ON t.week_number = w.week_number
GROUP BY w.week_number;

-- Application pipeline summary
CREATE VIEW v_pipeline AS
SELECT
    a.status,
    COUNT(*) AS count,
    GROUP_CONCAT(c.name || ' - ' || a.role_title, ' | ') AS roles
FROM applications a
JOIN companies c ON a.company_id = c.id
GROUP BY a.status
ORDER BY CASE a.status
    WHEN 'offer' THEN 1
    WHEN 'interview_final' THEN 2
    WHEN 'interview_2' THEN 3
    WHEN 'interview_1' THEN 4
    WHEN 'phone_screen' THEN 5
    WHEN 'responded' THEN 6
    WHEN 'applied' THEN 7
    WHEN 'researching' THEN 8
    ELSE 9
END;

-- Outreach effectiveness: who have I contacted and what happened?
CREATE VIEW v_outreach_status AS
SELECT
    c.name,
    c.relationship,
    COUNT(o.id) AS total_touches,
    MAX(o.sent_date) AS last_contact,
    o.response_status AS latest_status,
    o.next_action,
    o.next_action_date
FROM contacts c
LEFT JOIN outreach o ON o.contact_id = c.id
GROUP BY c.id
ORDER BY o.next_action_date ASC NULLS LAST;

-- Consulting pipeline value
CREATE VIEW v_consulting_pipeline AS
SELECT
    status,
    COUNT(*) AS count,
    SUM(estimated_value) AS total_value,
    GROUP_CONCAT(company || ': ' || service_type, ' | ') AS details
FROM consulting_leads
GROUP BY status;

-- Income tracker: cumulative earnings
CREATE VIEW v_income_summary AS
SELECT
    source,
    COUNT(*) AS payments,
    SUM(amount) AS total,
    MIN(date_received) AS first_payment,
    MAX(date_received) AS last_payment
FROM income
GROUP BY source;

-- What needs attention today?
CREATE VIEW v_action_items AS
SELECT 'Follow up on application' AS action_type, c.name || ' - ' || a.role_title AS detail, a.next_step_date AS due_date
FROM applications a JOIN companies c ON a.company_id = c.id
WHERE a.next_step_date <= DATE('now', '+2 days') AND a.status NOT IN ('rejected', 'withdrawn', 'ghosted', 'accepted')
UNION ALL
SELECT 'Outreach follow-up', ct.name, o.next_action_date
FROM outreach o JOIN contacts ct ON o.contact_id = ct.id
WHERE o.next_action_date <= DATE('now', '+2 days') AND o.response_status = 'pending'
UNION ALL
SELECT 'Task due', t.title, t.due_date
FROM tasks t
WHERE t.due_date <= DATE('now', '+2 days') AND t.status IN ('todo', 'in_progress')
UNION ALL
SELECT 'Interview prep', c.name || ' - ' || a.role_title, DATE(i.scheduled_at)
FROM interviews i JOIN applications a ON i.application_id = a.id JOIN companies c ON a.company_id = c.id
WHERE DATE(i.scheduled_at) <= DATE('now', '+3 days') AND i.outcome = 'pending'
ORDER BY due_date ASC;

-- ============================================================
-- SEED DATA: Week 1 plan from the blueprint
-- ============================================================

INSERT INTO weeks (week_number, title, theme, start_date, end_date, hours_budget, status) VALUES
(1, 'Foundation & Launch Prep', 'Set up infrastructure, activate network, start applications', '2026-03-31', '2026-04-06', 15, 'active'),
(2, 'Active Job Search + First Technical Content', 'Submit first applications, write first technical post, start building inbound', '2026-04-07', '2026-04-13', 15, 'upcoming'),
(3, 'Pipeline Building & Consulting Seeds', 'Expand applications, follow up relentlessly, plant consulting seeds', '2026-04-14', '2026-04-20', 15, 'upcoming'),
(4, 'Acceleration & First Revenue Target', 'Push for interviews, close first paid engagement', '2026-04-21', '2026-04-27', 15, 'upcoming'),
(5, 'Momentum & Diversification', 'Multiple irons in the fire; optimize what works, cut what doesn''t', '2026-04-28', '2026-05-04', 15, 'upcoming'),
(6, 'Closing & Negotiation', 'Convert pipeline into offers and signed contracts', '2026-05-05', '2026-05-11', 15, 'upcoming'),
(7, 'Decision & Optimization', 'Choose primary path; optimize secondary income streams', '2026-05-12', '2026-05-18', 15, 'upcoming'),
(8, 'Sustainable Growth System', 'Lock in recurring income; build compounding habits', '2026-05-19', '2026-05-25', 15, 'upcoming');

-- Week 1 goals
INSERT INTO weekly_goals (week_number, goal) VALUES
(1, 'Resume updated and saved as PDF'),
(1, 'LinkedIn profile rewritten (headline, About, Experience)'),
(1, 'Send 8 personal outreach messages (6 network + 2 recruiters)'),
(1, 'Research and save 15 target companies'),
(1, 'Submit 5 tailored job applications'),
(1, 'Tracking spreadsheet live and populated'),
(1, 'Join 2 communities (Firebase, Expo, Vancouver tech)'),
(1, 'Blog post outlined (not written)'),
(1, 'Calendly link set up'),
(1, 'Quick alignment conversation with Ash');

-- Week 1 tasks (mapped to the day-by-day plan)
INSERT INTO tasks (week_number, lane, title, description, hours_estimated, due_date) VALUES
-- Tuesday
(1, 'admin',           'Set up tracking spreadsheet',                      'Google Sheet: Company, Role, Source, Contact, Status, Next Step, Date', 0.75, '2026-03-31'),
(1, 'job_search',      'Start resume rewrite',                             'Lead with NextGen metrics: $250K/mo, team of 7, Firebase/GCP architecture', 1.5, '2026-03-31'),
(1, 'job_search',      'Research 5-8 target companies',                    'BuiltInVancouver, Glassdoor, LinkedIn. Save to spreadsheet, don''t apply yet', 0.75, '2026-03-31'),
-- Wednesday
(1, 'job_search',      'Finish and polish resume',                         'Clean 2-page PDF. Quantified achievements, not responsibilities', 1.0, '2026-04-01'),
(1, 'network_content', 'Rewrite LinkedIn profile',                         'Headline, About section (first person, outcomes-focused), Experience for NextGen', 1.5, '2026-04-01'),
(1, 'admin',           'Confirm transition with Ash',                      '10-min chat: board seat, advisory availability. Follow up with quick text confirming', 0.5, '2026-04-01'),
-- Thursday
(1, 'job_search',      'Apply to 2 best-fit roles',                        'Tailor each application. Reference their specific product. Use cover letter', 1.5, '2026-04-02'),
(1, 'network_content', 'Send 4 personal outreach messages',                'SFU/UBC/past work contacts. Personal note, not mass outreach. Reactivate relationships', 1.0, '2026-04-02'),
(1, 'network_content', 'Message 2 recruiters (Procom, Robert Half)',        'Find specific recruiter on LinkedIn. Frame as available for senior contract work', 0.5, '2026-04-02'),
-- Friday
(1, 'job_search',      'Apply to 3 more roles',                            'Mix: at least 1 remote-friendly and 1 contract. Total for week = 5', 1.5, '2026-04-03'),
(1, 'network_content', 'Join 2 communities',                               'Firebase Google Group, Expo Discord, Vancouver Tech Slack, or r/ExperiencedDevs', 0.5, '2026-04-03'),
(1, 'network_content', 'Outline first technical blog post',                'Topic: Firestore onSnapshot scaling. Outline: problem, attempts, solution, numbers', 1.0, '2026-04-03'),
(1, 'admin',           'Set up Calendly link',                             'Free tier, 30-min slots. Include in outreach starting Week 2', 0.25, '2026-04-03'),
(1, 'admin',           'End-of-week review: update spreadsheet',           'Status all applications, outreach responses, plan for next week', 0.25, '2026-04-03'),
-- Weekend (optional)
(1, 'network_content', 'Respond to outreach replies + schedule chats',     'Book coffee chats for Week 2', 0.5, '2026-04-05'),
(1, 'admin',           'Show wife the tracking spreadsheet',               'Walk through: applications, outreach, pipeline, plan. Build partnership around this', 0.5, '2026-04-05'),
(1, 'job_search',      'Research 7 more companies (total 15)',             'Expand search: remote-friendly US companies, Wellfound startups, contract marketplaces', 1.0, '2026-04-05');
