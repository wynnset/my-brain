'use strict';

const bcrypt = require('bcrypt');
const registryDb = require('../tenancy/registry-db.js');
const session = require('../lib/session.js');

function registerCoreRoutes(app, ctx) {
  const {
    tenancy,
    dashManifest,
    getRegistryReadonly,
  } = ctx;

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.get('/api/auth-status', (req, res) => {
    const out = {
      loginRequired: session.dashboardAuthEnabled(),
    };
    const payload = session.parseSessionFromCookie(req.headers.cookie || '');
    if (payload && payload.sub) {
      try {
        const t = tenancy.tenantPaths(payload.sub);
        const r = dashManifest.resolveDashboardManifest(t.workspaceDir, t.dataDir);
        out.dashboardPages = r.dashboardPages;
        out.dashboardNavPages = dashManifest.navPayloadFromEnabled(r.enabledPages);
      } catch (_) {
        out.dashboardPages = { career: false, finance: false, business: false, personal: false, family: false };
        out.dashboardNavPages = [];
      }
    } else {
      out.dashboardPages = { career: false, finance: false, business: false, personal: false, family: false };
      out.dashboardNavPages = [];
    }
    if (session.dashboardAuthEnabled() && payload && payload.sub) {
      const reg = getRegistryReadonly();
      if (reg) {
        const row = registryDb.findUserSessionSummary(reg, payload.sub);
        if (row) {
          out.account = {
            login: row.login,
            displayName: row.display_name || row.login,
          };
        }
      }
    }
    res.json(out);
  });

  app.post('/api/login', async (req, res) => {
    if (!session.dashboardAuthEnabled()) {
      return res.status(400).json({
        error: 'Dashboard login is not configured. Set SESSION_SECRET (32+ chars) and add users via scripts/brain-add-user.cjs.',
      });
    }
    const exp = Math.floor(Date.now() / 1000) + session.SESS_MAX_AGE_SEC;
    const login = String((req.body && req.body.login) || '').trim();
    const password = String((req.body && req.body.password) || '');
    if (!login || !password) {
      return res.status(400).json({ error: 'Missing login or password' });
    }
    let reg;
    try {
      reg = registryDb.openRegistryReadWrite(tenancy.registryDbPath());
      const row = registryDb.findUserByLogin(reg, login);
      if (!row) {
        reg.close();
        return res.status(401).json({ error: 'Invalid login or password' });
      }
      const ok = await bcrypt.compare(password, row.password_hash);
      reg.close();
      reg = null;
      if (!ok) return res.status(401).json({ error: 'Invalid login or password' });
      const token = session.signSessionPayload({ sub: row.id, exp, v: 1 });
      session.setSessionCookie(res, token, session.SESS_MAX_AGE_SEC);
      return res.json({ ok: true });
    } catch (err) {
      if (reg) try { reg.close(); } catch (_) {}
      console.error('[login]', err.message);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/logout', (req, res) => {
    session.clearSessionCookie(res);
    res.json({ ok: true });
  });
}

module.exports = { registerCoreRoutes };
