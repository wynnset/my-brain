'use strict';

function pathNeedsTenantBrain(url) {
  const p = url.split('?')[0];
  if (p.startsWith('/api/dashboard-page/')) return true;
  if (p.startsWith('/api/dashboard-section/')) return true;
  if (p.startsWith('/api/dashboard-section-todos/')) return true;
  if (p.startsWith('/api/dashboard-section-view/')) return true;
  if (p.startsWith('/api/action-domain/')) return true;
  return p === '/api/dashboard'
    || p === '/api/dashboard-manifest'
    || p === '/api/career'
    || p === '/api/finance'
    || p === '/api/business';
}

function createRequireTenantBrainMiddleware(ctx) {
  const { tenantDataDirReady } = ctx;
  return function requireTenantBrainMiddleware(req, res, next) {
    if (!pathNeedsTenantBrain(req.originalUrl)) return next();
    if (!req.tenant || !tenantDataDirReady(req.tenant.dataDir)) {
      return res.status(503).json({
        error: 'Database files missing on server',
        hint: 'Ensure brain.db exists for this account under the tenant data directory.',
      });
    }
    next();
  };
}

module.exports = { pathNeedsTenantBrain, createRequireTenantBrainMiddleware };
