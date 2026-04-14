'use strict';

const session = require('../lib/session.js');

function pathNeedsTenantBrain(url) {
  const p = url.split('?')[0];
  if (p.startsWith('/api/dashboard-page/')) return true;
  if (p.startsWith('/api/dashboard-section/')) return true;
  return p === '/api/dashboard'
    || p === '/api/dashboard-manifest'
    || p === '/api/career'
    || p === '/api/finance'
    || p === '/api/business';
}

function createRequireTenantBrainMiddleware(ctx) {
  const { tenantDataDirReady, dbsReady } = ctx;
  return function requireTenantBrainMiddleware(req, res, next) {
    if (!pathNeedsTenantBrain(req.originalUrl)) return next();
    if (session.multiUserMode()) {
      if (!req.tenant || !tenantDataDirReady(req.tenant.dataDir)) {
        return res.status(503).json({
          error: 'Database files missing on server',
          hint: 'Ensure brain.db exists for this account under the tenant data directory.',
        });
      }
      return next();
    }
    if (!dbsReady()) {
      return res.status(503).json({
        error: 'Database files missing on server',
        hint: 'Upload brain.db, launchpad.db, finance.db, wynnset.db to the volume under DB_DIR, then restart the machine.',
      });
    }
    next();
  };
}

module.exports = { pathNeedsTenantBrain, createRequireTenantBrainMiddleware };
