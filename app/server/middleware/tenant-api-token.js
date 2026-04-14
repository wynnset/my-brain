'use strict';

const registryDb = require('../tenancy/registry-db.js');
const session = require('../lib/session.js');

/** Bearer API token → req.tenant (multi-user only). */
function createTryAttachTenantFromApiToken(ctx) {
  const { getRegistryReadonly, tenancy } = ctx;
  return function tryAttachTenantFromApiToken(req, res, next) {
    if (!session.multiUserMode()) return next();
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return next();
    const reg = getRegistryReadonly();
    if (!reg) return next();
    const row = registryDb.findUserByApiToken(reg, token);
    if (!row) return next();
    try {
      req.tenant = tenancy.tenantPaths(row.id);
    } catch (_) {
      return next();
    }
    next();
  };
}

module.exports = { createTryAttachTenantFromApiToken };
