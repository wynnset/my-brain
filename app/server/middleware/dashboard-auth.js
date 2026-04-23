'use strict';

const session = require('../lib/session.js');

function createDashboardAuthMiddleware(ctx) {
  const { tenancy } = ctx;
  return function dashboardAuthMiddleware(req, res, next) {
    if (!session.dashboardAuthEnabled()) return next();
    const p = req.path;
    if (p === '/login.html' && req.method === 'GET') return next();
    if (p === '/api/auth-status' && req.method === 'GET') return next();
    if ((p === '/api/db' || p === '/api/upload') && req.method === 'POST') {
      if (req.tenant) return next();
      const cookie = req.headers.cookie || '';
      const payload = session.parseSessionFromCookie(cookie);
      if (payload && payload.sub) {
        try {
          req.tenant = tenancy.tenantPaths(payload.sub);
          return next();
        } catch (_) {}
      }
      return res.status(401).json({ error: 'Unauthorized', needsLogin: true });
    }
    const cookie = req.headers.cookie || '';
    const payload = session.parseSessionFromCookie(cookie);
    if (payload) {
      if (payload.sub) {
        try {
          req.tenant = tenancy.tenantPaths(payload.sub);
        } catch (_) {
          return res.status(401).json({ error: 'Unauthorized', needsLogin: true });
        }
      }
      return next();
    }
    if (p.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized', needsLogin: true });
    }
    if (req.method === 'GET' && req.accepts('html')) {
      return res.redirect(302, '/login.html');
    }
    return res.status(401).end();
  };
}

module.exports = { createDashboardAuthMiddleware };
