'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveDashboardManifest,
  buildBuiltinManifestDefinition,
  isSafeSelectSql,
  findEnabledSection,
} = require('./dashboard-manifest.js');

test('missing dashboard.json uses builtin three slugs (single-tenant)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'launchpad.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: false });
  assert.equal(r.pages.length, 3);
  const career = r.pages.find((p) => p.slug === 'career' && p.template === 'sections');
  assert.ok(career);
  assert.ok(career.enabled);
  assert.ok(!r.pages.find((p) => p.slug === 'finance').enabled);
});

test('missing dashboard.json in multi-user yields no default domain pages', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'launchpad.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.pages.length, 0);
  assert.equal(r.enabledPages.length, 0);
});

test('dashboard.json pages [] yields no enabled pages', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.writeFileSync(path.join(tmp, 'dashboard.json'), JSON.stringify({ version: 1, pages: [] }), 'utf8');
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'launchpad.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: false });
  assert.equal(r.enabledPages.length, 0);
  assert.equal(r.dashboardPages.career, false);
});

test('custom slug with career template', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        { slug: 'jobs', label: 'Job search', template: 'career' },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'launchpad.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: false });
  assert.equal(r.enabledPages.length, 1);
  assert.equal(r.enabledPages[0].slug, 'jobs');
  assert.equal(r.enabledPages[0].template, 'career');
});

test('multi-user allows career template when listed and launchpad.db exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [{ slug: 'jobs', label: 'Job search', template: 'career' }],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'launchpad.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  assert.equal(r.enabledPages.length, 1);
  assert.equal(r.enabledPages[0].template, 'career');
});

test('sections page enables when any child section has its db', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'reports',
          label: 'Reports',
          template: 'sections',
          sections: [
            { id: 'a', label: 'A', template: 'datatable', db: 'missing', sql: 'SELECT 1' },
            { id: 'b', label: 'B', template: 'datatable', db: 'finance', sql: 'SELECT 2 AS n' },
          ],
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'finance.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  assert.equal(r.enabledPages.length, 1);
  const p = r.enabledPages[0];
  assert.equal(p.template, 'sections');
  assert.equal(p.sections.length, 2);
  assert.equal(p.sections[0].enabled, false);
  assert.equal(p.sections[1].enabled, true);
  const hit = findEnabledSection(tmp, dataDir, { multiUser: true }, 'reports', 'b');
  assert.ok(hit);
  assert.equal(hit.section.id, 'b');
  assert.ok(!findEnabledSection(tmp, dataDir, { multiUser: true }, 'reports', 'a'));
});

test('datatable page normalizes and requires db file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'ledger-preview',
          label: 'Ledger',
          template: 'datatable',
          db: 'finance',
          sql: 'SELECT 1 AS n',
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  const r0 = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r0.enabledPages.length, 0);
  fs.writeFileSync(path.join(dataDir, 'finance.db'), '');
  const r1 = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r1.enabledPages.length, 1);
  assert.equal(r1.enabledPages[0].template, 'datatable');
  assert.equal(r1.enabledPages[0].apiPath, '/api/dashboard-page/ledger-preview');
});

test('datatable page accepts optional columns with format and rejects invalid format', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-dtcols-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'finance.db'), '');
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'ledger-preview',
          label: 'Ledger',
          template: 'datatable',
          db: 'finance',
          sql: 'SELECT 1 AS n',
          columns: [{ key: 'n', label: 'N', format: 'currency' }],
        },
      ],
    }),
    'utf8',
  );
  const rOk = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(rOk.errors.length, 0);
  assert.equal(rOk.enabledPages[0].columnSpecs.length, 1);
  assert.equal(rOk.enabledPages[0].columnSpecs[0].format, 'currency');

  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'bad',
          label: 'Bad',
          template: 'datatable',
          db: 'finance',
          sql: 'SELECT 1 AS n',
          columns: [{ key: 'n', label: 'N', format: 'not_a_real_format' }],
        },
      ],
    }),
    'utf8',
  );
  const rBad = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.ok(rBad.errors.some((e) => String(e).includes('not_a_real_format')));
});

test('sections page normalizes job_pipeline and week_card to funnel_bars and progress_card', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-rich-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'career2',
          label: 'Career',
          template: 'sections',
          sections: [
            { id: 'pipe', label: 'Pipeline', template: 'job_pipeline', layout: 'half' },
            { id: 'week', label: 'Week', template: 'week_card', layout: 'condensed' },
          ],
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'launchpad.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  const p = r.enabledPages[0];
  assert.equal(p.sections[0].template, 'funnel_bars');
  assert.equal(p.sections[0].layout, 'half');
  assert.equal(p.sections[1].template, 'progress_card');
  assert.equal(p.sections[1].layout, 'half');
});

test('sections page accepts account_cards', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-acct-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'fin',
          label: 'Finance',
          template: 'sections',
          sections: [
            {
              id: 'accounts',
              label: 'Accounts',
              template: 'account_cards',
              db: 'finance',
              sql: 'SELECT 1 AS name, "chequing" AS account_type, "personal" AS owner, 0 AS balance, "2025-01-01" AS snapshot_date',
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'finance.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  assert.equal(r.enabledPages[0].sections[0].template, 'account_cards');
});

test('sections page accepts link_groups with static groups', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-links-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'fin',
          label: 'Finance',
          template: 'sections',
          sections: [
            {
              id: 'alinks',
              label: 'Accounts',
              template: 'link_groups',
              db: 'finance',
              groups: [
                {
                  column: 1,
                  heading: 'A',
                  links: [{ label: 'One', href: 'https://example.com', external: true }],
                },
                {
                  column: 2,
                  heading: 'B',
                  links: [{ label: 'Two', href: '/files', external: false }],
                },
              ],
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'finance.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  const p = r.enabledPages[0];
  assert.equal(p.sections[0].template, 'link_groups');
  assert.equal(p.sections[0].groups.length, 2);
});

test('sections page accepts stat_cards, grouped_accordion, and metric_datatable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-rich2-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'biz',
          label: 'Biz',
          template: 'sections',
          sections: [
            {
              id: 'kpi',
              label: 'KPIs',
              template: 'stat_cards',
              db: 'wynnset',
              sql: "SELECT 'a' AS label, 'b' AS value, 'c' AS sub, 'slate' AS value_tone",
            },
            {
              id: 'coa',
              label: 'COA',
              template: 'grouped_accordion',
              db: 'wynnset',
              sql: 'SELECT 1 AS code, "a" AS name, "asset" AS type, "" AS subtype',
              groupColumn: 'type',
            },
            {
              id: 'loan',
              label: 'Loan',
              template: 'metric_datatable',
              db: 'wynnset',
              sqlSummary: 'SELECT 1 AS running_balance',
              sqlTable: 'SELECT 1 AS n',
              tableColumns: [{ key: 'n', label: 'N' }],
            },
          ],
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'wynnset.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  const p = r.enabledPages[0];
  assert.equal(p.sections[0].template, 'stat_cards');
  assert.equal(p.sections[1].template, 'grouped_accordion');
  assert.equal(p.sections[1].groupColumn, 'type');
  assert.equal(p.sections[2].template, 'metric_datatable');
  assert.equal(p.sections[2].tableColumns.length, 1);
});

test('sections page accepts todos section with domain', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-todos-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'work',
          label: 'Work',
          template: 'sections',
          sections: [
            { id: 'todos', label: 'Todos', template: 'todos', domain: 'career' },
          ],
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'brain.db'), '');
  const r = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r.errors.length, 0);
  const p = r.enabledPages[0];
  assert.equal(p.template, 'sections');
  assert.equal(p.sections[0].template, 'todos');
  assert.equal(p.sections[0].actionDomain, 'career');
});

test('isSafeSelectSql accepts single select and rejects comments', () => {
  assert.ok(isSafeSelectSql('SELECT * FROM foo'));
  assert.ok(!isSafeSelectSql('SELECT * FROM foo -- x'));
  assert.ok(!isSafeSelectSql('DELETE FROM foo'));
});

test('builtin manifest shape', () => {
  const b = buildBuiltinManifestDefinition(false);
  assert.equal(b.pages.length, 3);
  const b2 = buildBuiltinManifestDefinition(true);
  assert.equal(b2.pages.length, 0);
});

test('action_domain page requires brain.db and exposes actionDomain', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ad-'));
  fs.writeFileSync(
    path.join(tmp, 'dashboard.json'),
    JSON.stringify({
      version: 1,
      pages: [
        {
          slug: 'family',
          label: 'Family',
          template: 'action_domain',
          domain: 'family',
        },
      ],
    }),
    'utf8',
  );
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  const r0 = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r0.enabledPages.length, 0);
  fs.writeFileSync(path.join(dataDir, 'brain.db'), '');
  const r1 = resolveDashboardManifest(tmp, dataDir, { multiUser: true });
  assert.equal(r1.errors.length, 0);
  assert.equal(r1.enabledPages.length, 1);
  const p = r1.enabledPages[0];
  assert.equal(p.template, 'action_domain');
  assert.equal(p.actionDomain, 'family');
  assert.equal(p.apiPath, '/api/action-domain/family');
  assert.equal(r1.dashboardPages.family, true);
  assert.equal(r1.dashboardPages.personal, false);
});
