'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { volumeRoot, isMultiUser } = require('./tenancy-utils.js');

const MARKER = '.migrated-to-multiuser';
const LEGACY_UUID_FILE = '.legacy-tenant-uuid';

const WORKSPACE_NAMES = ['team', 'docs', 'owners-inbox', 'team-inbox'];
const WORKSPACE_FILES = ['CYRUS.md', 'LARRY.md'];

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Move or rename; if EXDEV (cross-device), copy then remove source.
 */
function moveIfExists(from, to) {
  if (!exists(from)) return;
  mkdirp(path.dirname(to));
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    } else {
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
    }
  }
}

/**
 * DB + registry volume root (same as tenancy volumeRoot()).
 * @param {string} vol
 */
function resolveLegacyWorkspaceRoot(vol) {
  const v = path.resolve(vol);
  if (process.env.LEGACY_WORKSPACE_DIR) {
    return path.resolve(String(process.env.LEGACY_WORKSPACE_DIR).trim());
  }
  if (process.env.DATA_DIR) {
    const d = path.resolve(String(process.env.DATA_DIR).trim());
    if (d !== v) return d;
  }
  // Local default: DBs in repo/data/, markdown trees in repo root (parent of data/)
  const base = path.basename(v);
  if (base === 'data') {
    const parent = path.dirname(v);
    if (parent && parent !== v) {
      const hasTeam = exists(path.join(parent, 'team')) && isDir(path.join(parent, 'team'));
      const hasCyrus = exists(path.join(parent, 'CYRUS.md'));
      if (hasTeam || hasCyrus) return parent;
    }
  }
  return v;
}

function dirHasVisibleChildren(dirPath) {
  if (!isDir(dirPath)) return false;
  try {
    return fs.readdirSync(dirPath).some((n) => !n.startsWith('.'));
  } catch (_) {
    return false;
  }
}

/**
 * If volume has legacy layout (DBs under volume root; workspace maybe same root or DATA_DIR / repo root), move into users/<uuid>/workspace|data.
 * @returns {{ migrated: boolean, tenantId?: string, message?: string }}
 */
function runLegacyVolumeMigrationIfNeeded() {
  if (!isMultiUser()) return { migrated: false };

  const vol = path.resolve(volumeRoot());
  const marker = path.join(vol, MARKER);
  if (exists(marker)) return { migrated: false };

  const usersDir = path.join(vol, 'users');
  const hasTenantedData = exists(usersDir) && fs.readdirSync(usersDir).some((id) => {
    const brain = path.join(usersDir, id, 'data', 'brain.db');
    return exists(brain);
  });
  if (hasTenantedData) {
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
    return { migrated: false, message: 'Multi-user layout already present; wrote migration marker.' };
  }

  const wsRoot = resolveLegacyWorkspaceRoot(vol);
  const sameRoot = wsRoot === vol;

  const brainInVol = exists(path.join(vol, 'brain.db'));
  const teamInVol = dirHasVisibleChildren(path.join(vol, 'team'));
  const teamInWs = !sameRoot && dirHasVisibleChildren(path.join(wsRoot, 'team'));
  const legacyLooksPresent = brainInVol || teamInVol || teamInWs;

  if (!legacyLooksPresent) {
    return { migrated: false, message: 'No legacy flat data to migrate.' };
  }

  const tenantId = crypto.randomUUID();
  const base = path.join(vol, 'users', tenantId);
  const workspace = path.join(base, 'workspace');
  const data = path.join(base, 'data');
  mkdirp(workspace);
  mkdirp(data);

  // SQLite + chat under volume root (always vol, not repo root)
  for (const db of ['brain.db', 'launchpad.db', 'finance.db', 'wynnset.db']) {
    moveIfExists(path.join(vol, db), path.join(data, db));
  }
  moveIfExists(path.join(vol, 'chat-sessions'), path.join(data, 'chat-sessions'));
  moveIfExists(path.join(vol, 'chat-tool-audit.log'), path.join(data, 'chat-tool-audit.log'));

  // config.json: usually next to DBs (vol); if only on wsRoot, pick that up below
  moveIfExists(path.join(vol, 'config.json'), path.join(workspace, 'config.json'));

  // Workspace trees: first from vol (Fly-style flat /data)
  for (const name of WORKSPACE_NAMES) {
    moveIfExists(path.join(vol, name), path.join(workspace, name));
  }
  for (const f of WORKSPACE_FILES) {
    moveIfExists(path.join(vol, f), path.join(workspace, f));
  }

  // Split layout: repo root (or DATA_DIR) has team/docs/… not under vol
  if (!sameRoot) {
    if (!exists(path.join(workspace, 'config.json'))) {
      moveIfExists(path.join(wsRoot, 'config.json'), path.join(workspace, 'config.json'));
    }
    for (const name of WORKSPACE_NAMES) {
      if (!exists(path.join(workspace, name))) {
        moveIfExists(path.join(wsRoot, name), path.join(workspace, name));
      }
    }
    for (const f of WORKSPACE_FILES) {
      if (!exists(path.join(workspace, f))) {
        moveIfExists(path.join(wsRoot, f), path.join(workspace, f));
      }
    }
  }

  fs.writeFileSync(path.join(vol, LEGACY_UUID_FILE), `${tenantId}\n`, 'utf8');
  fs.writeFileSync(marker, `${new Date().toISOString()} tenant=${tenantId}\n`, 'utf8');

  const layoutNote = sameRoot ? 'flat volume' : `split layout (DBs: ${vol}, workspace: ${wsRoot})`;
  console.log(`[migrate] Legacy (${layoutNote}) → users/${tenantId}/`);
  console.log('[migrate] Create login: node scripts/brain-add-user.cjs --claim-legacy --login YOUR_LOGIN --password ...');

  return { migrated: true, tenantId, workspaceSource: wsRoot, dataSource: vol };
}

module.exports = {
  runLegacyVolumeMigrationIfNeeded,
  resolveLegacyWorkspaceRoot,
  MARKER,
  LEGACY_UUID_FILE,
};
