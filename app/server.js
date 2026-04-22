'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const tenancy = require('./server/tenancy/tenancy-utils.js');
const registryDb = require('./server/tenancy/registry-db.js');
const tenantDbMod = require('./server/tenancy/tenant-db.js');
const dashManifest = require('./server/dashboard/dashboard-manifest.js');
const { runLegacyVolumeMigrationIfNeeded } = require('./server/migrate/volume-migrate.js');
const { safeTenantSqliteBase } = require('./server/lib/tenant-sqlite.js');
const { q, q1 } = require('./server/lib/db-query.js');
const { createOrchestratorBrief } = require('./server/lib/orchestrator-brief.js');
const session = require('./server/lib/session.js');
const { createTryAttachTenantFromApiToken } = require('./server/middleware/tenant-api-token.js');
const { createDashboardAuthMiddleware } = require('./server/middleware/dashboard-auth.js');
const { createRequireTenantBrainMiddleware } = require('./server/middleware/dashboard-tenant-brain.js');
const { registerPublicRoutes, registerProtectedRoutes } = require('./server/routes/index.js');

/** Repo root `.env` — set ANTHROPIC_API_KEY, BRAIN_CHAT_BACKEND, etc. without shell exports. */
(function loadDotenv() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });
  } catch (e) {
    if (e && e.code !== 'MODULE_NOT_FOUND') console.warn('[env] .env load failed:', e.message);
  }
})();

const app = express();
const PORT = process.env.PORT || 3131;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'data');
const REPO_ROOT_DIR = path.join(__dirname, '..');

if (session.multiUserMode()) {
  if (!process.env.SESSION_SECRET || String(process.env.SESSION_SECRET).length < 32) {
    console.error('BRAIN_MULTI_USER=1 requires SESSION_SECRET (at least 32 characters).');
    process.exit(1);
  }
  try {
    registryDb.ensureRegistrySchema(tenancy.registryDbPath());
  } catch (e) {
    console.error('[registry]', e.message);
    process.exit(1);
  }
  try {
    const mig = runLegacyVolumeMigrationIfNeeded();
    if (mig.migrated) console.log('[migrate] legacy volume → users/', mig.tenantId);
    if (mig.message && !mig.migrated) console.log('[migrate]', mig.message);
  } catch (e) {
    console.error('[migrate]', e.message);
    process.exit(1);
  }
}

const orchestrator = createOrchestratorBrief(DATA_DIR, REPO_ROOT_DIR);
orchestrator.ensureOrchestratorBriefMigrated();

// ─── Open databases (legacy single-tenant only; multi-user opens per request) ─
let brain;
let launchpad;
let finance;
let wynnset;
function openDbReadonlyAt(dir, filename) {
  const p = path.join(dir, filename);
  if (!fs.existsSync(p)) {
    console.warn(`Database missing (ok for first boot): ${p}`);
    return null;
  }
  try {
    return new Database(p, { readonly: true });
  } catch (err) {
    console.error(`Failed to open database ${p}:`, err.message);
    return null;
  }
}

function openDbReadonly(filename) {
  return openDbReadonlyAt(DB_DIR, filename);
}

/** Ensure optional markdown column exists (dashboard edits / richer notes). */
function migrateBrainActionItemsDetails() {
  if (session.multiUserMode()) return;
  const p = path.join(DB_DIR, 'brain.db');
  if (!fs.existsSync(p)) return;
  let rw;
  try {
    rw = new Database(p);
    const names = new Set(rw.prepare(`PRAGMA table_info(action_items)`).all().map((c) => c.name));
    if (!names.has('details')) {
      rw.exec(`ALTER TABLE action_items ADD COLUMN details TEXT`);
      console.log('brain.db: added column action_items.details');
    }
  } catch (err) {
    console.warn('brain.db migration (action_items.details):', err.message);
  } finally {
    if (rw) try { rw.close(); } catch (_) {}
  }
}
migrateBrainActionItemsDetails();

if (!session.multiUserMode()) {
  brain = openDbReadonly('brain.db');
  launchpad = openDbReadonly('launchpad.db');
  finance = openDbReadonly('finance.db');
  wynnset = openDbReadonly('wynnset.db');
} else {
  brain = launchpad = finance = wynnset = null;
}
const dbsReady = () => brain && launchpad && finance && wynnset;
if (!session.multiUserMode()) {
  if (dbsReady()) console.log('All databases opened successfully.');
  else console.warn('Some databases missing — upload *.db to DB_DIR, then restart.');
}

const migratedBrainDetailsDirs = new Set();
function ensureTenantBrainDetailsMigrated(dataDir) {
  const key = path.resolve(dataDir);
  if (migratedBrainDetailsDirs.has(key)) return;
  tenantDbMod.migrateBrainActionItemsDetails(dataDir);
  migratedBrainDetailsDirs.add(key);
}

function tenantDataDirForRequest(req) {
  if (session.multiUserMode()) {
    if (!req.tenant) throw new Error('Tenant required');
    return req.tenant.dataDir;
  }
  return DB_DIR;
}

function workspaceDirForRequest(req) {
  if (session.multiUserMode()) {
    if (!req.tenant) throw new Error('Tenant required');
    return req.tenant.workspaceDir;
  }
  return DATA_DIR;
}

function dashboardManifestOpts() {
  return { multiUser: session.multiUserMode() };
}

function dashboardResolve(req) {
  return dashManifest.resolveDashboardManifest(
    workspaceDirForRequest(req),
    tenantDataDirForRequest(req),
    dashboardManifestOpts(),
  );
}

function dashboardPagesForRequest(req) {
  return dashboardResolve(req).dashboardPages;
}

function templatesEnabledForRequest(req) {
  return dashManifest.enabledTemplates(
    workspaceDirForRequest(req),
    tenantDataDirForRequest(req),
    dashboardManifestOpts(),
  );
}

/** Multi-user: only `brain.db` is required; other domain DBs are created when needed. */
function tenantDataDirReady(dataDir) {
  return fs.existsSync(path.join(dataDir, 'brain.db'));
}

/** Run handler with open tenant DBs; closes handles in multi-user mode when done. */
function withTenantDatabases(req, res, sendJson) {
  const dataDir = tenantDataDirForRequest(req);
  if (session.multiUserMode()) {
    ensureTenantBrainDetailsMigrated(dataDir);
    if (!tenantDataDirReady(dataDir)) {
      return res.status(503).json({
        error: 'Database files missing for this account',
        hint: 'Ensure brain.db exists under the tenant data directory.',
      });
    }
    const dbs = tenantDbMod.openTenantDatabases(dataDir);
    try {
      sendJson(dbs);
    } finally {
      dbs.close();
    }
  } else {
    if (!dbsReady()) {
      return res.status(503).json({
        error: 'Database files missing on server',
        hint: 'Upload brain.db, launchpad.db, finance.db, wynnset.db to the volume under DB_DIR, then restart the machine.',
      });
    }
    sendJson({ brain, launchpad, finance, wynnset });
  }
}

let registryReadonlyDb = null;
function getRegistryReadonly() {
  if (!session.multiUserMode()) return null;
  if (!registryReadonlyDb) {
    const p = tenancy.registryDbPath();
    if (!fs.existsSync(p)) return null;
    registryReadonlyDb = new Database(p, { readonly: true });
  }
  return registryReadonlyDb;
}

/**
 * Run `fn(db)` against a short-lived read-write handle to registry.db. Used by
 * server-side paths (credit limits, admin updates) that mutate tenant counters
 * we never want to expose through the dashboard DB API.
 * Returns whatever `fn` returns, or `null` if multi-user mode is off / the file
 * does not exist yet.
 */
function withRegistryReadWrite(fn) {
  if (!session.multiUserMode()) return null;
  const p = tenancy.registryDbPath();
  if (!fs.existsSync(p)) return null;
  const db = registryDb.openRegistryReadWrite(p);
  try {
    return fn(db);
  } finally {
    try { db.close(); } catch (_) {}
  }
}

// ─── Stream-error safety net ─────────────────────────────────────────────────
// The Claude Agent SDK spawns the `claude` CLI as a child process with stdio
// pipes. If that child (or a stdio MCP server we spawn, or an SSE client that
// disconnected mid-stream) is killed/closed, a pending write surfaces an
// asynchronous `'error'` event on the underlying Socket. Because the SDK does
// not attach its own listener, Node treats it as unhandled and the whole
// dashboard dies. Swallow these benign pipe errors so a transient chat failure
// does not take the server down — they still get logged for debugging.
function isBenignStreamError(err) {
  if (!err || typeof err !== 'object') return false;
  const code = err.code;
  return code === 'EPIPE' || code === 'ECONNRESET' || code === 'ERR_STREAM_DESTROYED';
}
process.on('uncaughtException', (err) => {
  if (isBenignStreamError(err)) {
    console.warn(`[server] ignored stream error: ${err.code} ${err.syscall || ''} ${err.message || ''}`.trim());
    return;
  }
  console.error('[server] uncaughtException:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  if (isBenignStreamError(reason)) {
    console.warn(`[server] ignored stream rejection: ${reason.code} ${reason.message || ''}`.trim());
    return;
  }
  console.error('[server] unhandledRejection:', reason);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  [brain, launchpad, finance, wynnset].forEach((db) => {
    if (db) try { db.close(); } catch (_) {}
  });
  if (registryReadonlyDb) try { registryReadonlyDb.close(); } catch (_) {}
  console.log('\nDatabases closed. Goodbye.');
  process.exit(0);
});

// ─── Core middleware (static is mounted after auth, below) ───────────────────
app.use(express.json());
app.use(createTryAttachTenantFromApiToken({ getRegistryReadonly, tenancy }));

(async () => {
  const { appendAssistantStreamChunk } = await import(
    pathToFileURL(path.join(__dirname, 'public', 'shared', 'stream-chunk.mjs')).href,
  );

  const ctx = {
    path,
    fs,
    crypto,
    spawn,
    pathToFileURL,
    Database,
    tenancy,
    registryDb,
    dashManifest,
    DATA_DIR,
    DB_DIR,
    safeTenantSqliteBase,
    tenantDataDirForRequest,
    workspaceDirForRequest,
    dashboardManifestOpts,
    dashboardResolve,
    dashboardPagesForRequest,
    templatesEnabledForRequest,
    withTenantDatabases,
    getRegistryReadonly,
    withRegistryReadWrite,
    q,
    q1,
    orchestrator,
    multiUserMode: session.multiUserMode,
    appendAssistantStreamChunk,
  };

  registerPublicRoutes(app, ctx);

  app.use(createDashboardAuthMiddleware({ tenancy }));
  app.use(createRequireTenantBrainMiddleware({ tenantDataDirReady, dbsReady }));

  registerProtectedRoutes(app, ctx);

  // ─── Static (dashboard + assets) — after auth gate ─────────────────────────
  app.use(express.static(path.join(__dirname, 'public'), { index: 'dashboard.html' }));

  const server = app.listen(PORT, async () => {
    console.log(`Cyrus dashboard running at http://localhost:${PORT}`);
    if (session.multiUserMode()) {
      console.log(`Multi-tenant volume root: ${tenancy.volumeRoot()}`);
    } else {
      console.log(`Data directory: ${DATA_DIR}`);
    }
    try {
      const { default: open } = await import('open');
      await open(`http://localhost:${PORT}`);
    } catch (_) {}
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} node server.js`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});