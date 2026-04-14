'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ACTION_DOMAIN = new Set(['career', 'finance', 'business', 'personal', 'family']);
const ACTION_URGENCY = new Set(['critical', 'high', 'medium', 'low']);
const ACTION_STATUS = new Set(['open', 'done', 'dismissed']);

function registerDomainRoutes(app, ctx) {
  const {
    templatesEnabledForRequest,
    withTenantDatabases,
    tenantDataDirForRequest,
    q,
    q1,
  } = ctx;

  app.get('/api/career', (req, res) => {
    if (!templatesEnabledForRequest(req).has('career')) {
      return res.status(404).json({
        error: 'Career-type dashboard is not enabled (add launchpad.db and/or adjust workspace/dashboard.json).',
      });
    }
    withTenantDatabases(req, res, (dbs) => {
      const { brain, launchpad } = dbs;
      const actionItems = q(brain, `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category, project_week
    FROM action_items
    WHERE status = 'open' AND domain = 'career'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

      const pipeline = q(launchpad, `SELECT * FROM v_pipeline`);

      const activeApplications = q(launchpad, `
    SELECT a.id, c.name AS company_name, a.role_title, a.role_type, a.status,
           a.next_step, a.next_step_date, a.salary_range, a.applied_date, a.referral_from
    FROM applications a
    JOIN companies c ON a.company_id = c.id
    WHERE a.status NOT IN ('rejected', 'withdrawn', 'ghosted', 'accepted')
    ORDER BY
      CASE a.status
        WHEN 'offer'          THEN 1
        WHEN 'interview_final'THEN 2
        WHEN 'interview_2'    THEN 3
        WHEN 'interview_1'    THEN 4
        WHEN 'phone_screen'   THEN 5
        WHEN 'responded'      THEN 6
        WHEN 'applied'        THEN 7
        ELSE 8
      END, a.next_step_date ASC NULLS LAST
  `);

      const activeWeek = q1(launchpad, `SELECT * FROM weeks WHERE status = 'active' LIMIT 1`);
      const weekGoals = activeWeek
        ? q(launchpad, `SELECT * FROM weekly_goals WHERE week_number = ? ORDER BY id`, [activeWeek.week_number])
        : [];

      const outreach = q(launchpad, `SELECT * FROM v_outreach_status ORDER BY next_action_date ASC NULLS LAST LIMIT 20`);

      const consultingLeads = q(launchpad, `
    SELECT cl.id, cl.company, cl.service_type, cl.estimated_value, cl.hourly_rate,
           cl.status, cl.closed_date, ct.name AS contact_name
    FROM consulting_leads cl
    LEFT JOIN contacts ct ON cl.contact_id = ct.id
    WHERE cl.status NOT IN ('won', 'lost')
    ORDER BY
      CASE cl.status
        WHEN 'negotiating'    THEN 1
        WHEN 'proposal_sent'  THEN 2
        WHEN 'conversation'   THEN 3
        ELSE 4
      END
  `);

      const consultingPipeline = q(launchpad, `SELECT * FROM v_consulting_pipeline`);

      res.json({ actionItems, pipeline, activeApplications, activeWeek, weekGoals, outreach, consultingLeads, consultingPipeline });
    });
  });

  app.get('/api/finance', (req, res) => {
    if (!templatesEnabledForRequest(req).has('finance')) {
      return res.status(404).json({
        error: 'Finance-type dashboard is not enabled (add finance.db and/or adjust workspace/dashboard.json).',
      });
    }
    withTenantDatabases(req, res, (dbs) => {
      const { brain, finance, wynnset } = dbs;
      const actionItems = q(brain, `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category
    FROM action_items
    WHERE status = 'open' AND domain = 'finance'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

      const burnRate = q(finance, `SELECT * FROM v_burn_rate_monthly ORDER BY month DESC LIMIT 3`);

      const categorySpend = q(finance, `
    SELECT * FROM v_monthly_by_category
    WHERE month = (SELECT MAX(month) FROM v_monthly_by_category)
    ORDER BY total_spent DESC
  `);

      const income = q(finance, `SELECT * FROM v_income_monthly ORDER BY month DESC LIMIT 6`);

      const topMerchants = q(finance, `SELECT * FROM v_top_merchants LIMIT 10`);

      const accountSnapshots = q(finance, `
    SELECT a.name, a.account_type, a.owner, a.institution,
           s.balance, s.available_credit, s.snapshot_date
    FROM account_snapshots s
    JOIN accounts a ON s.account_id = a.id
    WHERE s.id IN (
      SELECT MAX(id) FROM account_snapshots GROUP BY account_id
    )
    ORDER BY a.owner, a.account_type
  `);

      const complianceUpcoming = q(wynnset, `SELECT * FROM v_compliance_upcoming ORDER BY due_date`);

      const trialBalanceSummary = q(wynnset, `
    SELECT type,
      ROUND(SUM(total_debits), 2) AS debits,
      ROUND(SUM(total_credits), 2) AS credits,
      ROUND(SUM(net), 2) AS net
    FROM v_trial_balance
    GROUP BY type
    ORDER BY CASE type
      WHEN 'asset'     THEN 1
      WHEN 'liability' THEN 2
      WHEN 'equity'    THEN 3
      WHEN 'revenue'   THEN 4
      WHEN 'expense'   THEN 5
    END
  `);

      const shareholderLoan = q1(wynnset, `SELECT * FROM v_shareholder_loan_balance`);

      const shareholderLoanTxns = q(wynnset, `
    SELECT txn_date, description, amount, direction, running_balance, txn_type
    FROM shareholder_loan ORDER BY id DESC LIMIT 5
  `);

      res.json({
        actionItems, burnRate, categorySpend, income, topMerchants,
        accountSnapshots, complianceUpcoming, trialBalanceSummary,
        shareholderLoan, shareholderLoanTxns
      });
    });
  });

  app.get('/api/business', (req, res) => {
    if (!templatesEnabledForRequest(req).has('business')) {
      return res.status(404).json({
        error: 'Business-type dashboard is not enabled (add wynnset.db and/or adjust workspace/dashboard.json).',
      });
    }
    withTenantDatabases(req, res, (dbs) => {
      const { brain, wynnset } = dbs;
      const actionItems = q(brain, `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category
    FROM action_items
    WHERE status = 'open' AND domain = 'business'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

      const complianceCalendar = q(wynnset, `
    SELECT id, event_type, description, due_date, fiscal_period, status,
           completed_date, completed_by, notes
    FROM compliance_events
    ORDER BY
      CASE status WHEN 'upcoming' THEN 1 WHEN 'overdue' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
      due_date ASC
  `);

      const complianceSummary = q(wynnset, `
    SELECT status, COUNT(*) AS count FROM compliance_events GROUP BY status
  `);

      const ledgerSummary = q1(wynnset, `
    SELECT COUNT(*) AS total_entries,
           MIN(entry_date) AS first_entry,
           MAX(entry_date) AS last_entry
    FROM journal_entries
  `);

      const coaSummary = q(wynnset, `
    SELECT type, COUNT(*) AS account_count
    FROM accounts_coa WHERE is_active = 1
    GROUP BY type
    ORDER BY CASE type
      WHEN 'asset'     THEN 1
      WHEN 'liability' THEN 2
      WHEN 'equity'    THEN 3
      WHEN 'revenue'   THEN 4
      WHEN 'expense'   THEN 5
    END
  `);

      const coaAccounts = q(wynnset, `
    SELECT code, name, type, subtype, description
    FROM accounts_coa WHERE is_active = 1 ORDER BY code
  `);

      const shareholderLoan = q1(wynnset, `SELECT * FROM v_shareholder_loan_balance`);

      res.json({ actionItems, complianceCalendar, complianceSummary, ledgerSummary, coaSummary, coaAccounts, shareholderLoan });
    });
  });

  app.patch('/api/action-items/:id', (req, res) => {
    const brainPath = path.join(tenantDataDirForRequest(req), 'brain.db');
    if (!fs.existsSync(brainPath)) {
      return res.status(503).json({ error: 'brain.db not available' });
    }
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid action item id' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sets = [];
    const params = [];

    if (body.title !== undefined) {
      const t = String(body.title || '').trim();
      if (!t) return res.status(400).json({ error: 'title cannot be empty' });
      sets.push('title = ?');
      params.push(t);
    }
    if (body.description !== undefined) {
      const v = body.description === null || body.description === '' ? null : String(body.description);
      sets.push('description = ?');
      params.push(v);
    }
    if (body.details !== undefined) {
      const v = body.details === null || body.details === '' ? null : String(body.details);
      sets.push('details = ?');
      params.push(v);
    }
    if (body.due_date !== undefined) {
      if (body.due_date === null || body.due_date === '') {
        sets.push('due_date = NULL');
      } else {
        sets.push('due_date = ?');
        params.push(String(body.due_date).trim().slice(0, 32));
      }
    }
    if (body.urgency !== undefined) {
      const u = String(body.urgency);
      if (!ACTION_URGENCY.has(u)) return res.status(400).json({ error: 'invalid urgency' });
      sets.push('urgency = ?');
      params.push(u);
    }
    if (body.domain !== undefined) {
      const d = String(body.domain);
      if (!ACTION_DOMAIN.has(d)) return res.status(400).json({ error: 'invalid domain' });
      sets.push('domain = ?');
      params.push(d);
    }
    if (body.status !== undefined) {
      const s = String(body.status);
      if (!ACTION_STATUS.has(s)) return res.status(400).json({ error: 'invalid status' });
      sets.push('status = ?');
      params.push(s);
      if (s === 'done') {
        sets.push(`completed_at = CURRENT_TIMESTAMP`);
      } else {
        sets.push('completed_at = NULL');
      }
    }
    if (body.project_category !== undefined) {
      const v = body.project_category === null || body.project_category === '' ? null : String(body.project_category);
      sets.push('project_category = ?');
      params.push(v);
    }
    if (body.effort_hours !== undefined) {
      if (body.effort_hours === null || body.effort_hours === '') {
        sets.push('effort_hours = NULL');
      } else {
        const n = Number(body.effort_hours);
        if (Number.isNaN(n)) return res.status(400).json({ error: 'invalid effort_hours' });
        sets.push('effort_hours = ?');
        params.push(n);
      }
    }
    if (body.project_week !== undefined) {
      if (body.project_week === null || body.project_week === '') {
        sets.push('project_week = NULL');
      } else {
        const n = parseInt(body.project_week, 10);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid project_week' });
        sets.push('project_week = ?');
        params.push(n);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No updatable fields' });
    }

    let rw;
    try {
      rw = new Database(brainPath);
      const row = rw.prepare('SELECT id FROM action_items WHERE id = ?').get(id);
      if (!row) {
        rw.close();
        return res.status(404).json({ error: 'Action item not found' });
      }
      const sql = `UPDATE action_items SET ${sets.join(', ')} WHERE id = ?`;
      params.push(id);
      rw.prepare(sql).run(...params);
      rw.close();
      rw = null;
    } catch (err) {
      console.error('PATCH /api/action-items:', err.message);
      if (rw) try { rw.close(); } catch (_) {}
      return res.status(500).json({ error: err.message || 'Update failed' });
    }
    return res.json({ ok: true });
  });
}

module.exports = { registerDomainRoutes };
