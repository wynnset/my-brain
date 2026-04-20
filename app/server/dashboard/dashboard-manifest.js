'use strict';

const fs = require('fs');
const path = require('path');
const { builtinDomainSectionPages } = require('./builtin-domain-sections.js');

/** Basenames only (no path / `.db`); aligned with POST /api/db allowlist. */
const DB_BASE_RE = /^[a-z][a-z0-9_-]{0,62}$/i;
const RESERVED_SLUGS = new Set(['home', 'files', 'chat', 'login', 'api', 'usage']);
const SLUG_RE = /^[a-z][a-z0-9-]{0,48}$/;

/** Values allowed in `brain.db` `action_items.domain` — must match server PATCH allowlist. */
const ACTION_DOMAIN_FOR_MANIFEST = ['career', 'finance', 'business', 'personal', 'family'];
const ACTION_DOMAIN_FOR_MANIFEST_SET = new Set(ACTION_DOMAIN_FOR_MANIFEST);

const TEMPLATE = {
  career: {
    apiPath: '/api/career',
    defaultLabel: 'Career',
    defaultDescription: 'Job search, consulting pipeline & weekly progress',
    defaultRequireDbs: ['launchpad'],
  },
  finance: {
    apiPath: '/api/finance',
    defaultLabel: 'Finance',
    defaultDescription: 'Personal spending, income & corporate accounting',
    defaultRequireDbs: ['finance'],
  },
  business: {
    apiPath: '/api/business',
    defaultLabel: 'Business',
    defaultDescription: 'Corporate compliance, ledger & chart of accounts',
    defaultRequireDbs: ['wynnset'],
  },
};

function buildBuiltinManifestDefinition(multiUser) {
  if (multiUser) {
    return { version: 1, pages: [] };
  }
  /** Default tenant: three domain tabs as `sections` (SQL-driven datatables), same data as legacy domain APIs. */
  return { version: 1, pages: builtinDomainSectionPages() };
}

function readManifestFile(workspaceDir) {
  const base = String(workspaceDir || '').trim();
  if (!base) return null;
  const p = path.join(base, 'dashboard.json');
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function sanitizeDbBase(name) {
  const s = String(name || '')
    .trim()
    .replace(/\.db$/i, '');
  if (!s || !DB_BASE_RE.test(s)) return null;
  return s;
}

/** Allowed `columns[].format` for `template: "datatable"` (sections or standalone page). */
const DATATABLE_COLUMN_FORMATS = new Set([
  'auto',
  'text',
  'optional_text',
  'badge',
  'enum',
  'currency',
  'date',
  'datelong',
  'capitalize',
  'days_remaining',
  'net_tone',
  'direction_arrow',
]);

/**
 * Optional `[{ key, label?, format?, secondaryKey? }]` for datatable sections/pages.
 * @returns {{ columnSpecs: null | Array<{key: string, label: string, format: string, secondaryKey: string|null}> } | { error: string }}
 */
function normalizeDatatableColumnSpecs(rawColumns, contextLabel) {
  if (rawColumns == null || rawColumns === undefined) return { columnSpecs: null };
  if (!Array.isArray(rawColumns)) {
    return { error: `${contextLabel}: "columns" must be an array of { key, label?, format?, secondaryKey? }` };
  }
  if (rawColumns.length === 0) return { columnSpecs: null };
  const columnSpecs = [];
  for (let i = 0; i < rawColumns.length; i++) {
    const c = rawColumns[i];
    if (!c || typeof c !== 'object') {
      return { error: `${contextLabel}: columns[${i}] must be an object` };
    }
    const key = String(c.key || '').trim();
    if (!key) return { error: `${contextLabel}: columns[${i}] needs a non-empty "key"` };
    const label = c.label != null && String(c.label).trim() !== '' ? String(c.label) : key;
    const rawFmt = c.format != null ? String(c.format).trim().toLowerCase() : 'auto';
    const format = rawFmt === 'date_long' ? 'datelong' : rawFmt || 'auto';
    if (!DATATABLE_COLUMN_FORMATS.has(format)) {
      return {
        error:
          `${contextLabel}: column "${key}" has invalid format "${c.format}". ` +
          `Use one of: auto, text, optional_text, badge, enum, currency, date, dateLong, capitalize, days_remaining, net_tone, direction_arrow`,
      };
    }
    const secondaryKey =
      c.secondaryKey != null && String(c.secondaryKey).trim() !== ''
        ? String(c.secondaryKey).trim()
        : null;
    columnSpecs.push({ key, label, format, secondaryKey });
  }
  return { columnSpecs };
}

/** Single SELECT only; used for dashboard `datatable` pages. */
function isSafeSelectSql(sql) {
  const s = String(sql || '').trim();
  if (s.length < 8 || s.length > 20000) return false;
  if (!/^\s*SELECT\b/is.test(s)) return false;
  if (/\b(attach|vacuum|reindex|pragma|delete|insert|update|replace|drop|alter|create|detach|truncate)\b/i.test(s)) {
    return false;
  }
  if (/--/.test(s)) return false;
  const semi = s.match(/;/g);
  if (semi && semi.length > 1) return false;
  if (semi && semi.length === 1 && !/;\s*$/.test(s)) return false;
  return true;
}

function dbsSatisfied(dataDir, requireDbs) {
  const base = String(dataDir || '').trim();
  if (!base || !requireDbs.length) return false;
  return requireDbs.every((n) => fs.existsSync(path.join(base, `${n}.db`)));
}

/** Section width in the sections grid: `half` = one column on md+ (pair for 2-column layout). */
function parseSectionLayout(raw) {
  const x = String((raw && raw.layout) || 'full')
    .trim()
    .toLowerCase();
  if (x === 'half' || x === 'condensed' || x === 'narrow') return 'half';
  return 'full';
}

/** Static categorized links (`link_groups` template). */
function normalizeLinkGroups(rawGroups, id, parentSlug) {
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    return {
      error: `Section "${id}" on "${parentSlug}" (link_groups): non-empty "groups" array is required`,
    };
  }
  const groups = [];
  for (let i = 0; i < rawGroups.length; i++) {
    const g = rawGroups[i];
    if (!g || typeof g !== 'object') continue;
    const heading = String(g.heading != null ? g.heading : g.title || '').trim();
    if (!heading) {
      return {
        error: `Section "${id}" on "${parentSlug}" (link_groups): groups[${i}] needs "heading"`,
      };
    }
    let col = g.column != null ? parseInt(String(g.column), 10) : 1;
    if (col !== 2) col = 1;
    const linksRaw = g.links;
    if (!Array.isArray(linksRaw) || linksRaw.length === 0) {
      return {
        error: `Section "${id}" on "${parentSlug}" (link_groups): groups[${i}] needs non-empty "links"`,
      };
    }
    const links = [];
    for (let j = 0; j < linksRaw.length; j++) {
      const L = linksRaw[j];
      if (!L || typeof L !== 'object') continue;
      const label = String(L.label != null ? L.label : L.text || '').trim();
      const href = String(L.href != null ? L.href : L.url || '').trim();
      if (!label || !href) {
        return {
          error:
            `Section "${id}" on "${parentSlug}" (link_groups): groups[${i}].links[${j}] needs "label" and "href"`,
        };
      }
      let external = !!(L.external ?? L.is_external);
      if (L.external === undefined && L.is_external === undefined && /^https?:\/\//i.test(href)) {
        external = true;
      }
      links.push({ label, href, external });
    }
    if (!links.length) {
      return {
        error: `Section "${id}" on "${parentSlug}" (link_groups): groups[${i}] has no valid links`,
      };
    }
    groups.push({ heading, column: col, links });
  }
  if (!groups.length) {
    return { error: `Section "${id}" on "${parentSlug}" (link_groups): no valid groups` };
  }
  return { groups };
}

/** One block inside a `template: "sections"` page. */
function normalizeSectionEntry(raw, parentSlug, index) {
  if (!raw || typeof raw !== 'object') {
    return { error: `Invalid section at index ${index} on page "${parentSlug}"` };
  }
  const id = String(raw.id || '').trim().toLowerCase();
  const template = String(raw.template || '').trim().toLowerCase();
  if (!SLUG_RE.test(id) || RESERVED_SLUGS.has(id)) {
    return { error: `Invalid or reserved section id "${id}" on page "${parentSlug}"` };
  }
  if (id === parentSlug) {
    return { error: `Section id "${id}" must differ from page slug "${parentSlug}"` };
  }
  if (template === 'funnel_bars' || template === 'job_pipeline') {
    let db = sanitizeDbBase(raw.db);
    let sql = String(raw.sql == null ? '' : raw.sql).trim();
    if (template === 'job_pipeline') {
      if (!db) db = 'launchpad';
      if (!sql) sql = 'SELECT * FROM v_pipeline';
    }
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}" (funnel_bars): missing or invalid "db"` };
    }
    if (!isSafeSelectSql(sql)) {
      return {
        error:
          `Section "${id}" on "${parentSlug}" (funnel_bars): "sql" must be a single SELECT (label + count columns)`,
      };
    }
    const label = String(raw.label || 'Chart').trim() || 'Chart';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'Horizontal bar chart from query rows (label + value columns)';
    const labelColumn = String(raw.labelColumn || raw.label_column || 'status').trim() || 'status';
    const valueColumn = String(raw.valueColumn || raw.value_column || 'count').trim() || 'count';
    return {
      id,
      label,
      description,
      template: 'funnel_bars',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sql,
      labelColumn,
      valueColumn,
    };
  }
  if (template === 'progress_card' || template === 'week_card') {
    let db = sanitizeDbBase(raw.db);
    let sqlSummary = String(raw.sqlSummary == null ? '' : raw.sqlSummary).trim();
    let sqlItems = String(raw.sqlItems == null ? '' : raw.sqlItems).trim();
    if (template === 'week_card') {
      if (!db) db = 'launchpad';
      if (!sqlSummary) sqlSummary = "SELECT * FROM weeks WHERE status = 'active' LIMIT 1";
      if (!sqlItems) {
        sqlItems = `SELECT * FROM weekly_goals WHERE week_number = (SELECT week_number FROM weeks WHERE status = 'active' LIMIT 1) ORDER BY id`;
      }
    }
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}" (progress_card): missing or invalid "db"` };
    }
    if (!isSafeSelectSql(sqlSummary) || !isSafeSelectSql(sqlItems)) {
      return {
        error:
          `Section "${id}" on "${parentSlug}" (progress_card): "sqlSummary" and "sqlItems" must each be a single SELECT`,
      };
    }
    const label = String(raw.label || 'Progress').trim() || 'Progress';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'Summary row + checklist rows (e.g. week + goals)';
    return {
      id,
      label,
      description,
      template: 'progress_card',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sqlSummary,
      sqlItems,
    };
  }
  if (template === 'stat_cards') {
    const db = sanitizeDbBase(raw.db);
    const sql = String(raw.sql == null ? '' : raw.sql).trim();
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}" (stat_cards): missing or invalid "db"` };
    }
    if (!isSafeSelectSql(sql)) {
      return {
        error: `Section "${id}" on "${parentSlug}" (stat_cards): "sql" must be a single SELECT`,
      };
    }
    const label = String(raw.label || 'Summary').trim() || 'Summary';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'KPI cards from SQL rows (label, value, sub, value_tone)';
    const labelKey = String(raw.labelKey || raw.label_key || 'label').trim() || 'label';
    const valueKey = String(raw.valueKey || raw.value_key || 'value').trim() || 'value';
    const subKey = String(raw.subKey || raw.sub_key || 'sub').trim() || 'sub';
    const toneKey = String(raw.toneKey || raw.tone_key || 'value_tone').trim() || 'value_tone';
    return {
      id,
      label,
      description,
      template: 'stat_cards',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sql,
      labelKey,
      valueKey,
      subKey,
      toneKey,
    };
  }
  if (template === 'grouped_accordion') {
    const db = sanitizeDbBase(raw.db);
    const sql = String(raw.sql == null ? '' : raw.sql).trim();
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}" (grouped_accordion): missing or invalid "db"` };
    }
    if (!isSafeSelectSql(sql)) {
      return {
        error: `Section "${id}" on "${parentSlug}" (grouped_accordion): "sql" must be a single SELECT`,
      };
    }
    const label = String(raw.label || 'Grouped list').trim() || 'Grouped list';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'Rows grouped under expandable headers (e.g. chart of accounts)';
    const groupColumn = String(raw.groupColumn || raw.group_column || 'type').trim() || 'type';
    let accordionColumns = null;
    if (Array.isArray(raw.columns) && raw.columns.length) {
      accordionColumns = [];
      for (const c of raw.columns) {
        if (!c || typeof c !== 'object') continue;
        const ck = String(c.key || '').trim();
        if (!ck) continue;
        accordionColumns.push({
          key: ck,
          label: c.label != null ? String(c.label) : '',
        });
      }
    }
    if (!accordionColumns || !accordionColumns.length) {
      accordionColumns = [
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Name' },
        { key: 'subtype', label: '' },
      ];
    }
    let groupOrder = null;
    if (Array.isArray(raw.groupOrder)) {
      groupOrder = raw.groupOrder.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    }
    return {
      id,
      label,
      description,
      template: 'grouped_accordion',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sql,
      groupColumn,
      accordionColumns,
      groupOrder,
    };
  }
  if (template === 'metric_datatable') {
    const db = sanitizeDbBase(raw.db);
    const sqlSummary = String(raw.sqlSummary == null ? '' : raw.sqlSummary).trim();
    const sqlTable = String(raw.sqlTable == null ? '' : raw.sqlTable).trim();
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}" (metric_datatable): missing or invalid "db"` };
    }
    if (!sqlSummary || !sqlTable) {
      return {
        error: `Section "${id}" on "${parentSlug}" (metric_datatable): "sqlSummary" and "sqlTable" are required`,
      };
    }
    if (!isSafeSelectSql(sqlSummary) || !isSafeSelectSql(sqlTable)) {
      return {
        error:
          `Section "${id}" on "${parentSlug}" (metric_datatable): "sqlSummary" and "sqlTable" must each be a single SELECT`,
      };
    }
    const tableColumns = [];
    const rawCols = raw.tableColumns != null ? raw.tableColumns : raw.table_columns;
    if (Array.isArray(rawCols)) {
      for (const c of rawCols) {
        if (!c || typeof c !== 'object') continue;
        const ck = String(c.key || '').trim();
        if (!ck) continue;
        tableColumns.push({
          key: ck,
          label: c.label != null ? String(c.label) : ck,
        });
      }
    }
    if (!tableColumns.length) {
      return {
        error:
          `Section "${id}" on "${parentSlug}" (metric_datatable): non-empty "tableColumns" [{ key, label }, ...] is required`,
      };
    }
    const label = String(raw.label || 'Details').trim() || 'Details';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'Highlighted metric row plus a detail table';
    return {
      id,
      label,
      description,
      template: 'metric_datatable',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sqlSummary,
      sqlTable,
      tableColumns,
    };
  }
  if (template === 'account_cards') {
    const db = sanitizeDbBase(raw.db);
    const sql = String(raw.sql == null ? '' : raw.sql).trim();
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}" (account_cards): missing or invalid "db"` };
    }
    if (!isSafeSelectSql(sql)) {
      return {
        error: `Section "${id}" on "${parentSlug}" (account_cards): "sql" must be a single SELECT`,
      };
    }
    const label = String(raw.label || 'Accounts').trim() || 'Accounts';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'Balance cards (name, account_type, owner, balance, snapshot_date)';
    return {
      id,
      label,
      description,
      template: 'account_cards',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sql,
    };
  }
  if (template === 'link_groups') {
    const gateDb = sanitizeDbBase(raw.db) || 'finance';
    const ng = normalizeLinkGroups(raw.groups, id, parentSlug);
    if (ng.error) return { error: ng.error };
    const label = String(raw.label || 'Links').trim() || 'Links';
    const description =
      raw.description != null
        ? String(raw.description)
        : 'Two-column categorized links (headings + bullet links)';
    return {
      id,
      label,
      description,
      template: 'link_groups',
      layout: parseSectionLayout(raw),
      requireDbs: [gateDb],
      groups: ng.groups,
    };
  }
  if (template === 'todos') {
    const actionDomain = String(raw.domain || '').trim().toLowerCase();
    if (!ACTION_DOMAIN_FOR_MANIFEST_SET.has(actionDomain)) {
      return {
        error:
          `Section "${id}" on "${parentSlug}" (template "todos"): "domain" must be one of: ${ACTION_DOMAIN_FOR_MANIFEST.join(', ')}`,
      };
    }
    const label = String(raw.label || 'Todos').trim() || 'Todos';
    const description =
      raw.description != null
        ? String(raw.description)
        : `Open action items for the "${actionDomain}" domain`;
    return {
      id,
      label,
      description,
      template: 'todos',
      layout: parseSectionLayout(raw),
      actionDomain,
      requireDbs: ['brain'],
    };
  }
  if (template === 'datatable') {
    const db = sanitizeDbBase(raw.db);
    const sql = String(raw.sql == null ? '' : raw.sql).trim();
    if (!db) {
      return { error: `Section "${id}" on "${parentSlug}": missing or invalid "db"` };
    }
    if (!isSafeSelectSql(sql)) {
      return {
        error:
          `Section "${id}" on "${parentSlug}": "sql" must be a single SELECT only (no comments or multiple statements), max 20000 chars`,
      };
    }
    const label = String(raw.label || 'Table').trim() || 'Table';
    const description = raw.description != null ? String(raw.description) : 'Read-only query results';
    const dtCols = normalizeDatatableColumnSpecs(raw.columns, `Section "${id}" on "${parentSlug}"`);
    if (dtCols.error) return { error: dtCols.error };
    return {
      id,
      label,
      description,
      template: 'datatable',
      layout: parseSectionLayout(raw),
      requireDbs: [db],
      sql,
      columnSpecs: dtCols.columnSpecs,
    };
  }
  return {
    error:
      `Unknown section template "${template}" on page "${parentSlug}". ` +
      'Use: datatable, todos, funnel_bars, progress_card, stat_cards, grouped_accordion, metric_datatable, account_cards, link_groups (aliases: job_pipeline, week_card).',
  };
}

function normalizePageEntry(raw, index) {
  if (!raw || typeof raw !== 'object') {
    return { error: `Invalid page entry at index ${index}` };
  }
  const slug = String(raw.slug || '').trim().toLowerCase();
  const template = String(raw.template || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    return { error: `Invalid or reserved slug "${slug}" at index ${index}` };
  }

  if (template === 'sections') {
    if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
      return { error: `Page "${slug}" (template "sections"): non-empty "sections" array required` };
    }
    const seen = new Set();
    const sections = [];
    for (let j = 0; j < raw.sections.length; j++) {
      const sec = normalizeSectionEntry(raw.sections[j], slug, j);
      if (sec.error) return { error: sec.error };
      if (seen.has(sec.id)) {
        return { error: `Duplicate section id "${sec.id}" on page "${slug}"` };
      }
      seen.add(sec.id);
      sections.push(sec);
    }
    const label = String(raw.label || 'Overview').trim() || 'Overview';
    const description = raw.description != null ? String(raw.description) : 'Multiple sections on one page';
    return {
      slug,
      label,
      description,
      template: 'sections',
      sections,
      requireDbs: [],
      apiPath: null,
    };
  }

  if (template === 'datatable') {
    const db = sanitizeDbBase(raw.db);
    const sql = String(raw.sql == null ? '' : raw.sql).trim();
    if (!db) {
      return { error: `datatable page "${slug}": missing or invalid "db" (basename without .db)` };
    }
    if (!isSafeSelectSql(sql)) {
      return {
        error:
          `datatable page "${slug}": "sql" must be a single SELECT only (no comments or multiple statements), max 20000 chars`,
      };
    }
    const label = String(raw.label || 'Table').trim() || 'Table';
    const description = raw.description != null ? String(raw.description) : 'Read-only query results';
    const dtCols = normalizeDatatableColumnSpecs(raw.columns, `datatable page "${slug}"`);
    if (dtCols.error) return { error: dtCols.error };
    return {
      slug,
      label,
      description,
      template: 'datatable',
      requireDbs: [db],
      sql,
      columnSpecs: dtCols.columnSpecs,
      apiPath: `/api/dashboard-page/${encodeURIComponent(slug)}`,
    };
  }

  if (template === 'action_domain') {
    const actionDomain = String(raw.domain || '').trim().toLowerCase();
    if (!ACTION_DOMAIN_FOR_MANIFEST_SET.has(actionDomain)) {
      return {
        error:
          `action_domain page "${slug}": "domain" must be one of: ${ACTION_DOMAIN_FOR_MANIFEST.join(', ')} ` +
          '(matches `action_items.domain` in brain.db).',
      };
    }
    const rawLabel = String(raw.label || '').trim();
    const label =
      rawLabel ||
      actionDomain.charAt(0).toUpperCase() + actionDomain.slice(1);
    const description =
      raw.description != null
        ? String(raw.description)
        : `Open action items for the "${actionDomain}" domain`;
    return {
      slug,
      label,
      description,
      template: 'action_domain',
      actionDomain,
      requireDbs: ['brain'],
      apiPath: `/api/action-domain/${encodeURIComponent(slug)}`,
    };
  }

  const t = TEMPLATE[template];
  if (!t) {
    return {
      error:
        `Unknown template "${template}" for slug "${slug}". ` +
        'Use one of: career, finance, business, action_domain, datatable, sections.',
    };
  }
  const label = String(raw.label || t.defaultLabel).trim() || t.defaultLabel;
  const description = raw.description != null ? String(raw.description) : t.defaultDescription;
  let requireDbs;
  if (Array.isArray(raw.requireDbs) && raw.requireDbs.length) {
    requireDbs = [];
    for (const x of raw.requireDbs) {
      const b = sanitizeDbBase(x);
      if (!b) {
        return { error: `Invalid requireDbs entry for slug "${slug}"` };
      }
      requireDbs.push(b);
    }
    const def = [...t.defaultRequireDbs];
    if (requireDbs.length !== def.length || requireDbs.some((b, i) => b !== def[i])) {
      return {
        error:
          `slug "${slug}": template "${template}" requires requireDbs ${JSON.stringify(def)} ` +
          '(or omit requireDbs). Custom SQLite basenames are not wired to this template’s API yet — add a new server template or rename DB files to match the defaults.',
      };
    }
  } else {
    requireDbs = [...t.defaultRequireDbs];
  }
  return { slug, label, description, template, requireDbs, apiPath: t.apiPath };
}

/**
 * Resolve workspace `dashboard.json` against files on disk.
 * @param {object} [opts]
 * @param {boolean} [opts.multiUser]
 * - Missing file → built-in default (empty pages if multiUser; else Career / Finance / Business with stock slugs and DB gates).
 * - Multi-user with a custom file: `career` / `finance` / `business` templates are allowed whenever listed (same rules as single-tenant); tabs stay disabled until the matching `*.db` exists.
 * - `template: "datatable"` + `db` + `sql` → read-only table page backed by any tenant SQLite basename.
 * - `template: "sections"` + `sections: [{ id, template, ... }]` → one nav tab; each child section is currently a `datatable` (same `db`/`sql` rules). Page is enabled if at least one child section has its DB file.
 * - `template: "action_domain"` + `domain` → one nav tab of open `action_items` filtered to that domain (requires `brain.db` only). Same domains as `action_items.domain` in brain.db.
 */
function resolveDashboardManifest(workspaceDir, dataDir, opts) {
  const multiUser = !!(opts && opts.multiUser);
  const rawFile = readManifestFile(workspaceDir);
  const builtin = buildBuiltinManifestDefinition(multiUser);
  let pagesRaw;
  if (rawFile == null) {
    pagesRaw = builtin.pages;
  } else if (!Array.isArray(rawFile.pages)) {
    pagesRaw = builtin.pages;
  } else {
    pagesRaw = rawFile.pages;
  }

  const errors = [];
  const normalized = [];
  for (let i = 0; i < pagesRaw.length; i++) {
    const n = normalizePageEntry(pagesRaw[i], i);
    if (n.error) {
      errors.push(n.error);
      continue;
    }
    normalized.push(n);
  }

  const seen = new Set();
  const pages = [];
  for (const p of normalized) {
    if (seen.has(p.slug)) {
      errors.push(`Duplicate slug "${p.slug}" — skipping duplicate`);
      continue;
    }
    seen.add(p.slug);
    if (p.template === 'sections' && Array.isArray(p.sections)) {
      const sectionsGated = p.sections.map((s) => ({
        ...s,
        enabled: dbsSatisfied(dataDir, s.requireDbs),
      }));
      const enabled = sectionsGated.some((s) => s.enabled);
      pages.push({ ...p, sections: sectionsGated, enabled });
    } else {
      const enabled = dbsSatisfied(dataDir, p.requireDbs);
      pages.push({ ...p, enabled });
    }
  }

  const enabledPages = pages.filter((p) => p.enabled);
  const dashboardPages = {
    career: enabledPages.some((p) => p.slug === 'career' || p.template === 'career'),
    finance: enabledPages.some((p) => p.slug === 'finance' || p.template === 'finance'),
    business: enabledPages.some((p) => p.slug === 'business' || p.template === 'business'),
    personal: enabledPages.some((p) => p.template === 'action_domain' && p.actionDomain === 'personal'),
    family: enabledPages.some((p) => p.template === 'action_domain' && p.actionDomain === 'family'),
  };

  return {
    pages,
    enabledPages,
    dashboardPages,
    errors,
    usedCustomFile: rawFile != null,
  };
}

function enabledTemplates(workspaceDir, dataDir, opts) {
  const { enabledPages } = resolveDashboardManifest(workspaceDir, dataDir, opts);
  const s = new Set();
  for (const p of enabledPages) {
    s.add(p.template);
    if (p.slug === 'career') s.add('career');
    if (p.slug === 'finance') s.add('finance');
    if (p.slug === 'business') s.add('business');
  }
  return s;
}

function navPayloadFromEnabled(enabledPages) {
  return enabledPages.map((p) => {
    const o = {
      slug: p.slug,
      label: p.label,
      description: p.description,
      template: p.template,
      apiPath: p.apiPath || null,
    };
    if (p.template === 'action_domain' && p.actionDomain) {
      o.actionDomain = p.actionDomain;
    }
    if (p.template === 'sections' && Array.isArray(p.sections)) {
      o.sections = p.sections.map((s) => {
        const row = {
          id: s.id,
          label: s.label,
          description: s.description,
          template: s.template,
          layout: s.layout || 'full',
          enabled: s.enabled,
        };
        if (s.template === 'todos' && s.actionDomain) row.domain = s.actionDomain;
        return row;
      });
    }
    return o;
  });
}

function findEnabledPageBySlug(workspaceDir, dataDir, opts, slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s) || RESERVED_SLUGS.has(s)) return null;
  const { enabledPages } = resolveDashboardManifest(workspaceDir, dataDir, opts);
  return enabledPages.find((p) => p.slug === s) || null;
}

/** Enabled `datatable` section inside an enabled `sections` page (for GET /api/dashboard-section/...). */
function findEnabledSection(workspaceDir, dataDir, opts, pageSlug, sectionId) {
  const page = findEnabledPageBySlug(workspaceDir, dataDir, opts, pageSlug);
  if (!page || page.template !== 'sections' || !Array.isArray(page.sections)) return null;
  const sid = String(sectionId || '').trim().toLowerCase();
  if (!SLUG_RE.test(sid) || RESERVED_SLUGS.has(sid)) return null;
  const section = page.sections.find((x) => x.id === sid);
  if (!section || !section.enabled || section.template !== 'datatable' || !section.sql) return null;
  return { page, section };
}

/** Enabled `todos` section (for GET /api/dashboard-section-todos/...). */
function findEnabledTodosSection(workspaceDir, dataDir, opts, pageSlug, sectionId) {
  const page = findEnabledPageBySlug(workspaceDir, dataDir, opts, pageSlug);
  if (!page || page.template !== 'sections' || !Array.isArray(page.sections)) return null;
  const sid = String(sectionId || '').trim().toLowerCase();
  if (!SLUG_RE.test(sid) || RESERVED_SLUGS.has(sid)) return null;
  const section = page.sections.find((x) => x.id === sid);
  if (!section || !section.enabled || section.template !== 'todos' || !section.actionDomain) return null;
  return { page, section };
}

const RICH_VIEW_TEMPLATES = new Set([
  'funnel_bars',
  'progress_card',
  'stat_cards',
  'grouped_accordion',
  'metric_datatable',
  'account_cards',
  'link_groups',
]);

/** Enabled rich HTML section (`funnel_bars`, `progress_card`). */
function findEnabledRichSection(workspaceDir, dataDir, opts, pageSlug, sectionId) {
  const page = findEnabledPageBySlug(workspaceDir, dataDir, opts, pageSlug);
  if (!page || page.template !== 'sections' || !Array.isArray(page.sections)) return null;
  const sid = String(sectionId || '').trim().toLowerCase();
  if (!SLUG_RE.test(sid) || RESERVED_SLUGS.has(sid)) return null;
  const section = page.sections.find((x) => x.id === sid);
  if (!section || !section.enabled || !RICH_VIEW_TEMPLATES.has(section.template)) return null;
  return { page, section };
}

module.exports = {
  TEMPLATE,
  ACTION_DOMAIN_FOR_MANIFEST,
  ACTION_DOMAIN_FOR_MANIFEST_SET,
  RESERVED_SLUGS,
  SLUG_RE,
  buildBuiltinManifestDefinition,
  readManifestFile,
  resolveDashboardManifest,
  enabledTemplates,
  navPayloadFromEnabled,
  isSafeSelectSql,
  findEnabledPageBySlug,
  findEnabledSection,
  findEnabledTodosSection,
  findEnabledRichSection,
};
