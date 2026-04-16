'use strict';

const fs = require('fs');
const path = require('path');

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
  return {
    version: 1,
    pages: [
      { slug: 'career', label: 'Career', template: 'career', requireDbs: ['launchpad'] },
      { slug: 'finance', label: 'Finance', template: 'finance', requireDbs: ['finance'] },
      { slug: 'business', label: 'Business', template: 'business', requireDbs: ['wynnset'] },
    ],
  };
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

/** One block inside a `template: "sections"` page (currently `datatable` only). */
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
    return {
      id,
      label,
      description,
      template: 'datatable',
      requireDbs: [db],
      sql,
    };
  }
  return {
    error: `Unknown section template "${template}" on page "${parentSlug}". Use: datatable.`,
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
    return {
      slug,
      label,
      description,
      template: 'datatable',
      requireDbs: [db],
      sql,
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
    career: enabledPages.some((p) => p.template === 'career'),
    finance: enabledPages.some((p) => p.template === 'finance'),
    business: enabledPages.some((p) => p.template === 'business'),
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
  return new Set(enabledPages.map((p) => p.template));
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
      o.sections = p.sections.map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        template: s.template,
        enabled: s.enabled,
      }));
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
};
