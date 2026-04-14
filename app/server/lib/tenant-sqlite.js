'use strict';

/** Basename for `*.db` under a tenant `data/` (POST /api/db, MCP). Blocks `registry` and path tricks. */
const TENANT_SQLITE_BASE_RE = /^[a-z][a-z0-9_-]{0,62}$/i;
const TENANT_SQLITE_BLOCKLIST = new Set(['registry']);

function safeTenantSqliteBase(rawName) {
  const base = String(rawName || '')
    .trim()
    .replace(/\.db$/i, '');
  if (!TENANT_SQLITE_BASE_RE.test(base)) return null;
  if (TENANT_SQLITE_BLOCKLIST.has(base.toLowerCase())) return null;
  return base;
}

module.exports = {
  TENANT_SQLITE_BASE_RE,
  TENANT_SQLITE_BLOCKLIST,
  safeTenantSqliteBase,
};
