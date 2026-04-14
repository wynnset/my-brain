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
  assert.ok(r.pages.find((p) => p.slug === 'career' && p.template === 'career').enabled);
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
