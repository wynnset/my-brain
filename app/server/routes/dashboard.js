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
      const showLaunchpadHome =
        !session.multiUserMode() ||
        r.enabledPages.some((p) => p.slug === 'career' || p.template === 'career');
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
        const specList = page.columnSpecs && page.columnSpecs.length ? page.columnSpecs : null;
        const columns = specList
          ? specList.map((c) => c.key)
          : sliced.length
            ? Object.keys(sliced[0])
            : [];
        const payload = {
          slug: page.slug,
          label: page.label,
          columns,
          rows: sliced,
          truncated: rows.length > max,
        };
        if (specList) payload.columnSpecs = specList;
        res.json(payload);
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
        const specList = section.columnSpecs && section.columnSpecs.length ? section.columnSpecs : null;
        const columns = specList
          ? specList.map((c) => c.key)
          : sliced.length
            ? Object.keys(sliced[0])
            : [];
        const payload = {
          pageSlug: req.params.pageSlug,
          sectionId: section.id,
          label: section.label,
          columns,
          rows: sliced,
          truncated: rows.length > max,
        };
        if (specList) payload.columnSpecs = specList;
        res.json(payload);
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

  app.get('/api/dashboard-section-todos/:pageSlug/:sectionId', (req, res) => {
    try {
      const ws = workspaceDirForRequest(req);
      const dataDir = tenantDataDirForRequest(req);
      const hit = dashManifest.findEnabledTodosSection(
        ws,
        dataDir,
        dashboardManifestOpts(),
        req.params.pageSlug,
        req.params.sectionId,
      );
      if (!hit) {
        return res.status(404).json({ error: 'Todos section not found or not enabled' });
      }
      const { section } = hit;
      const dom = String(section.actionDomain);
      withTenantDatabases(req, res, (dbs) => {
        const { brain } = dbs;
        const actionItems = q(
          brain,
          `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category, project_week
    FROM action_items
    WHERE status = 'open' AND domain = ?
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `,
          [dom],
        );
        res.json({
          pageSlug: req.params.pageSlug,
          sectionId: section.id,
          label: section.label,
          actionDomain: dom,
          actionItems,
        });
      });
    } catch (err) {
      console.error('[dashboard-section-todos]', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/dashboard-section-view/:pageSlug/:sectionId', (req, res) => {
    try {
      const ws = workspaceDirForRequest(req);
      const dataDir = tenantDataDirForRequest(req);
      const hit = dashManifest.findEnabledRichSection(
        ws,
        dataDir,
        dashboardManifestOpts(),
        req.params.pageSlug,
        req.params.sectionId,
      );
      if (!hit) {
        return res.status(404).json({ error: 'Rich view section not found or not enabled' });
      }
      const { section } = hit;
      withTenantDatabases(req, res, (dbs) => {
        if (section.template === 'link_groups') {
          return res.json({
            view: 'link_groups',
            groups: section.groups,
            sectionId: section.id,
            label: section.label,
          });
        }
        const dbName = section.requireDbs && section.requireDbs[0];
        const db = dbName ? dbs[dbName] : null;
        if (!db) {
          return res.status(503).json({
            error: `Database "${dbName || 'unknown'}" is not available for this section`,
          });
        }
        if (section.template === 'funnel_bars') {
          const rows = q(db, section.sql);
          return res.json({
            view: 'funnel_bars',
            rows,
            labelColumn: section.labelColumn,
            valueColumn: section.valueColumn,
            sectionId: section.id,
            label: section.label,
          });
        }
        if (section.template === 'progress_card') {
          const summary = q1(db, section.sqlSummary);
          const items = q(db, section.sqlItems);
          return res.json({
            view: 'progress_card',
            summary,
            items,
            sectionId: section.id,
            label: section.label,
          });
        }
        if (section.template === 'stat_cards') {
          const rows = q(db, section.sql);
          return res.json({
            view: 'stat_cards',
            rows,
            labelKey: section.labelKey,
            valueKey: section.valueKey,
            subKey: section.subKey,
            toneKey: section.toneKey,
            sectionId: section.id,
            label: section.label,
          });
        }
        if (section.template === 'grouped_accordion') {
          const rows = q(db, section.sql);
          return res.json({
            view: 'grouped_accordion',
            rows,
            groupColumn: section.groupColumn,
            accordionColumns: section.accordionColumns,
            groupOrder: section.groupOrder || null,
            sectionId: section.id,
            label: section.label,
          });
        }
        if (section.template === 'metric_datatable') {
          const summary = q1(db, section.sqlSummary);
          const tableRows = q(db, section.sqlTable);
          return res.json({
            view: 'metric_datatable',
            summary,
            rows: tableRows,
            tableColumns: section.tableColumns,
            sectionId: section.id,
            label: section.label,
          });
        }
        if (section.template === 'account_cards') {
          const rows = q(db, section.sql);
          return res.json({
            view: 'account_cards',
            rows,
            sectionId: section.id,
            label: section.label,
          });
        }
        return res.status(500).json({ error: 'Unsupported rich view' });
      });
    } catch (err) {
      console.error('[dashboard-section-view]', err.message);
      res.status(400).json({ error: err.message });
    }
  });
}

module.exports = { registerDashboardRoutes };
