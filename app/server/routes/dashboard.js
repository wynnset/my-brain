'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const session = require('../lib/session.js');

function registerDashboardRoutes(app, ctx) {
  const {
    dashManifest,
    withTenantDatabases,
    dashboardResolve,
    tenantDataDirForRequest,
    workspaceDirForRequest,
    dashboardManifestOpts,
    q,
    q1,
  } = ctx;

  app.get('/api/dashboard', (req, res) => {
    withTenantDatabases(req, res, (dbs) => {
      const r = dashboardResolve(req);
      const { brain, launchpad } = dbs;
      const actionItems = q(brain, `
    SELECT id, domain, urgency, title, description, details, due_date, source_agent
    FROM action_items
    WHERE status = 'open'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

      const domainSummary = q(brain, `SELECT * FROM v_items_by_domain`);

      let activeWeek = null;
      let weekGoals = [];
      const showLaunchpadHome = !session.multiUserMode() || r.enabledPages.some((p) => p.template === 'career');
      if (showLaunchpadHome) {
        activeWeek = q1(launchpad, `SELECT * FROM weeks WHERE status = 'active' LIMIT 1`);
        weekGoals = activeWeek
          ? q(launchpad, `SELECT * FROM weekly_goals WHERE week_number = ? ORDER BY id`, [activeWeek.week_number])
          : [];
      }

      res.json({
        actionItems,
        domainSummary,
        activeWeek,
        weekGoals,
        dashboardPages: r.dashboardPages,
        dashboardNavPages: dashManifest.navPayloadFromEnabled(r.enabledPages),
      });
    });
  });

  app.get('/api/dashboard-manifest', (req, res) => {
    try {
      const r = dashboardResolve(req);
      res.json({
        nav: dashManifest.navPayloadFromEnabled(r.enabledPages),
        pages: r.pages,
        warnings: r.errors.length ? r.errors : undefined,
      });
    } catch (err) {
      console.error('[dashboard-manifest]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dashboard-page/:slug', (req, res) => {
    try {
      const ws = workspaceDirForRequest(req);
      const dataDir = tenantDataDirForRequest(req);
      const page = dashManifest.findEnabledPageBySlug(ws, dataDir, dashboardManifestOpts(), req.params.slug);
      if (!page || page.template !== 'datatable' || !page.sql) {
        return res.status(404).json({ error: 'Page not found or not a datatable view' });
      }
      const dbPath = path.join(dataDir, `${page.requireDbs[0]}.db`);
      if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Database file missing' });
      const ro = new Database(dbPath, { readonly: true });
      try {
        const stmt = ro.prepare(page.sql);
        if (!stmt.reader) {
          return res.status(400).json({ error: 'Only read-only SELECT queries are allowed' });
        }
        const rows = stmt.all();
        const max = 500;
        const sliced = rows.length > max ? rows.slice(0, max) : rows;
        const columns = sliced.length ? Object.keys(sliced[0]) : [];
        res.json({
          slug: page.slug,
          label: page.label,
          columns,
          rows: sliced,
          truncated: rows.length > max,
        });
      } finally {
        try {
          ro.close();
        } catch (_) {}
      }
    } catch (err) {
      console.error('[dashboard-page]', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/dashboard-section/:pageSlug/:sectionId', (req, res) => {
    try {
      const ws = workspaceDirForRequest(req);
      const dataDir = tenantDataDirForRequest(req);
      const hit = dashManifest.findEnabledSection(
        ws,
        dataDir,
        dashboardManifestOpts(),
        req.params.pageSlug,
        req.params.sectionId,
      );
      if (!hit) {
        return res.status(404).json({ error: 'Section not found or not a datatable view' });
      }
      const { section } = hit;
      const dbPath = path.join(dataDir, `${section.requireDbs[0]}.db`);
      if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Database file missing' });
      const ro = new Database(dbPath, { readonly: true });
      try {
        const stmt = ro.prepare(section.sql);
        if (!stmt.reader) {
          return res.status(400).json({ error: 'Only read-only SELECT queries are allowed' });
        }
        const rows = stmt.all();
        const max = 500;
        const sliced = rows.length > max ? rows.slice(0, max) : rows;
        const columns = sliced.length ? Object.keys(sliced[0]) : [];
        res.json({
          pageSlug: req.params.pageSlug,
          sectionId: section.id,
          label: section.label,
          columns,
          rows: sliced,
          truncated: rows.length > max,
        });
      } finally {
        try {
          ro.close();
        } catch (_) {}
      }
    } catch (err) {
      console.error('[dashboard-section]', err.message);
      res.status(400).json({ error: err.message });
    }
  });
}

module.exports = { registerDashboardRoutes };
