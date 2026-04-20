'use strict';

/**
 * Default `dashboard.json` when the file is missing (single-tenant): three nav tabs
 * (`career`, `finance`, `business`) implemented as `template: "sections"` with read-only
 * SQL blocks plus **`todos`**, **`funnel_bars`** / **`progress_card`** (aliases **`job_pipeline`**, **`week_card`**),
 * **`stat_cards`**, **`grouped_accordion`**, **`metric_datatable`**, **`account_cards`**, **`link_groups`**, and **`datatable`** (see `/api/dashboard-section-view/...` for HTML sections).
 */

const CAREER = {
  slug: 'career',
  label: 'Career',
  description: 'Job search, consulting pipeline & weekly progress',
  template: 'sections',
  sections: [
    {
      id: 'todos',
      label: 'Todos',
      template: 'todos',
      domain: 'career',
    },
    {
      id: 'job-pipeline',
      label: 'Job pipeline',
      template: 'job_pipeline',
      layout: 'half',
    },
    {
      id: 'applications',
      label: 'Active applications',
      template: 'datatable',
      db: 'launchpad',
      sql: `SELECT a.id, c.name AS company_name, a.role_title, a.role_type, a.status,
       a.next_step, a.next_step_date, a.salary_range, a.applied_date, a.referral_from
FROM applications a
JOIN companies c ON a.company_id = c.id
WHERE a.status NOT IN ('rejected', 'withdrawn', 'ghosted', 'accepted')
ORDER BY
  CASE a.status
    WHEN 'offer' THEN 1
    WHEN 'interview_final' THEN 2
    WHEN 'interview_2' THEN 3
    WHEN 'interview_1' THEN 4
    WHEN 'phone_screen' THEN 5
    WHEN 'responded' THEN 6
    WHEN 'applied' THEN 7
    ELSE 8
  END, a.next_step_date ASC NULLS LAST`,
    },
    {
      id: 'week-progress',
      label: 'Week progress',
      template: 'week_card',
      layout: 'half',
    },
    {
      id: 'outreach',
      label: 'Outreach',
      template: 'datatable',
      db: 'launchpad',
      sql: 'SELECT * FROM v_outreach_status ORDER BY next_action_date ASC NULLS LAST LIMIT 20',
    },
    {
      id: 'consulting-leads',
      label: 'Consulting leads',
      template: 'datatable',
      db: 'launchpad',
      sql: `SELECT cl.id, cl.company, cl.service_type, cl.estimated_value, cl.hourly_rate,
       cl.status, cl.closed_date, ct.name AS contact_name
FROM consulting_leads cl
LEFT JOIN contacts ct ON cl.contact_id = ct.id
WHERE cl.status NOT IN ('won', 'lost')
ORDER BY
  CASE cl.status
    WHEN 'negotiating' THEN 1
    WHEN 'proposal_sent' THEN 2
    WHEN 'conversation' THEN 3
    ELSE 4
  END`,
    },
    {
      id: 'consulting-pipeline',
      label: 'Consulting pipeline',
      template: 'datatable',
      db: 'launchpad',
      sql: 'SELECT * FROM v_consulting_pipeline',
    },
  ],
};

const FINANCE = {
  slug: 'finance',
  label: 'Finance',
  description: 'Personal spending, income & corporate accounting',
  template: 'sections',
  sections: [
    {
      id: 'todos',
      label: 'Todos',
      template: 'todos',
      domain: 'finance',
    },
    {
      id: 'accounts',
      label: 'Accounts',
      template: 'account_cards',
      db: 'finance',
      sql: `SELECT a.name, a.account_type, a.owner, a.institution,
       s.balance, s.available_credit, s.snapshot_date
FROM account_snapshots s
JOIN accounts a ON s.account_id = a.id
WHERE s.id IN (
  SELECT MAX(id) FROM account_snapshots GROUP BY account_id
)
ORDER BY a.owner, a.account_type`,
    },
    {
      id: 'burn',
      label: 'Burn rate (monthly)',
      template: 'datatable',
      db: 'finance',
      sql: 'SELECT * FROM v_burn_rate_monthly ORDER BY month DESC LIMIT 3',
    },
    {
      id: 'category-spend',
      label: 'Category spend (latest month)',
      template: 'datatable',
      db: 'finance',
      sql: `SELECT * FROM v_monthly_by_category
WHERE month = (SELECT MAX(month) FROM v_monthly_by_category)
ORDER BY total_spent DESC`,
    },
    {
      id: 'income',
      label: 'Income (recent months)',
      template: 'datatable',
      db: 'finance',
      sql: 'SELECT * FROM v_income_monthly ORDER BY month DESC LIMIT 6',
    },
    {
      id: 'merchants',
      label: 'Top merchants',
      template: 'datatable',
      db: 'finance',
      sql: 'SELECT * FROM v_top_merchants LIMIT 10',
    },
    {
      id: 'compliance-upcoming',
      label: 'Corporate compliance (upcoming)',
      template: 'datatable',
      db: 'wynnset',
      sql: 'SELECT * FROM v_compliance_upcoming ORDER BY due_date',
    },
    {
      id: 'trial-balance',
      label: 'Trial balance (summary)',
      template: 'datatable',
      db: 'wynnset',
      sql: `SELECT type,
  ROUND(SUM(total_debits), 2) AS debits,
  ROUND(SUM(total_credits), 2) AS credits,
  ROUND(SUM(net), 2) AS net
FROM v_trial_balance
GROUP BY type
ORDER BY CASE type
  WHEN 'asset' THEN 1
  WHEN 'liability' THEN 2
  WHEN 'equity' THEN 3
  WHEN 'revenue' THEN 4
  WHEN 'expense' THEN 5
END`,
    },
    {
      id: 'shareholder-loan',
      label: 'Shareholder Loan',
      template: 'metric_datatable',
      db: 'wynnset',
      sqlSummary: 'SELECT * FROM v_shareholder_loan_balance LIMIT 1',
      sqlTable: `SELECT txn_date, description, amount, direction, running_balance, txn_type
FROM shareholder_loan ORDER BY id DESC LIMIT 5`,
      tableColumns: [
        { key: 'txn_date', label: 'Date' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount' },
        { key: 'direction', label: 'Dir' },
      ],
    },
  ],
};

const BUSINESS = {
  slug: 'business',
  label: 'Business',
  description: 'Corporate compliance, ledger & chart of accounts',
  template: 'sections',
  sections: [
    {
      id: 'todos',
      label: 'Todos',
      template: 'todos',
      domain: 'business',
    },
    {
      id: 'wynnset-overview',
      label: 'WynnSet Overview',
      template: 'stat_cards',
      db: 'wynnset',
      sql: `SELECT 'Journal Entries' AS label,
  CAST((SELECT COUNT(*) FROM journal_entries) AS TEXT) AS value,
  CASE WHEN (SELECT COUNT(*) FROM journal_entries) = 0 THEN 'No entries yet'
       ELSE 'Last: ' || (SELECT MAX(entry_date) FROM journal_entries) END AS sub,
  'slate' AS value_tone
UNION ALL
SELECT 'Active Accounts',
  CAST((SELECT COUNT(*) FROM accounts_coa WHERE is_active = 1) AS TEXT),
  'in chart of accounts',
  'slate'
UNION ALL
SELECT 'Compliance',
  (SELECT CAST(COUNT(*) AS TEXT) FROM compliance_events WHERE status = 'upcoming') || ' upcoming',
  (SELECT CAST(COUNT(*) AS TEXT) FROM compliance_events WHERE status = 'overdue') || ' overdue',
  CASE WHEN (SELECT COUNT(*) FROM compliance_events WHERE status = 'overdue') > 0 THEN 'red' ELSE 'slate' END
UNION ALL
SELECT 'Shareholder Loan',
  CASE WHEN (SELECT COUNT(*) FROM v_shareholder_loan_balance) = 0
    THEN '—'
    ELSE printf('$%,d', CAST(ROUND(ABS((SELECT running_balance FROM v_shareholder_loan_balance LIMIT 1))) AS INTEGER)) END,
  CASE WHEN (SELECT COUNT(*) FROM v_shareholder_loan_balance) = 0 THEN ''
    WHEN (SELECT direction FROM v_shareholder_loan_balance LIMIT 1) = 'corp_owes_aidin' THEN 'Corp owes you'
    ELSE 'You owe corp' END,
  CASE WHEN (SELECT COUNT(*) FROM v_shareholder_loan_balance) = 0 THEN 'slate'
    WHEN (SELECT direction FROM v_shareholder_loan_balance LIMIT 1) = 'corp_owes_aidin' THEN 'emerald'
    ELSE 'red' END`,
    },
    {
      id: 'compliance-calendar',
      label: 'Compliance calendar',
      template: 'datatable',
      db: 'wynnset',
      sql: `SELECT id, event_type, description, due_date, fiscal_period, status,
       completed_date, completed_by, notes
FROM compliance_events
ORDER BY
  CASE status WHEN 'upcoming' THEN 1 WHEN 'overdue' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
  due_date ASC`,
    },
    {
      id: 'compliance-summary',
      label: 'Compliance summary',
      template: 'datatable',
      db: 'wynnset',
      sql: 'SELECT status, COUNT(*) AS count FROM compliance_events GROUP BY status',
    },
    {
      id: 'ledger-summary',
      label: 'Journal entries summary',
      template: 'datatable',
      db: 'wynnset',
      sql: `SELECT COUNT(*) AS total_entries,
       MIN(entry_date) AS first_entry,
       MAX(entry_date) AS last_entry
FROM journal_entries`,
    },
    {
      id: 'chart-of-accounts',
      label: 'Chart of Accounts',
      template: 'grouped_accordion',
      db: 'wynnset',
      sql: 'SELECT code, name, type, subtype, description FROM accounts_coa WHERE is_active = 1 ORDER BY code',
      groupColumn: 'type',
      groupOrder: ['asset', 'liability', 'equity', 'revenue', 'expense'],
      columns: [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'subtype', label: '' },
      ],
    },
  ],
};

function builtinDomainSectionPages() {
  return [CAREER, FINANCE, BUSINESS];
}

module.exports = { builtinDomainSectionPages, CAREER, FINANCE, BUSINESS };
