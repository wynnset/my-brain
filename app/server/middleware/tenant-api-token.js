'use strict';

const registryDb = require('../tenancy/registry-db.js');

/** Bearer API token → req.tenant. */
function createTryAttachTenantFromApiToken(ctx) {
  const { getRegistryReadonly, tenancy } = ctx;
  return function tryAttachTenantFromApiToken(req, res, next) {
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
