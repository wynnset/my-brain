'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TENANT_USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMultiUser() {
  return process.env.BRAIN_MULTI_USER === '1';
}

/** Default DB / tenancy volume when env unset — keep in sync with server.js `DB_DIR` default. */
const DEFAULT_VOLUME_ROOT = path.join(__dirname, '..', 'data');

/** Volume root: registry.db + users/ (Fly: /data when DB_DIR=/data). */
function volumeRoot() {
  const raw = (process.env.TENANT_VOLUME_ROOT || process.env.DB_DIR || DEFAULT_VOLUME_ROOT).trim();
  return path.resolve(raw);
}

function registryDbPath() {
  return path.join(volumeRoot(), 'registry.db');
}

function tenantPaths(userId) {
  const id = String(userId || '').trim();
  if (!TENANT_USER_ID_RE.test(id)) throw new Error('Invalid tenant user id');
  const root = volumeRoot();
  const base = path.join(root, 'users', id);
  return {
    userId: id,
    root: base,
    workspaceDir: path.join(base, 'workspace'),
    dataDir: path.join(base, 'data'),
  };
}

/**
 * Ensure candidatePath is under rootDir (after resolve). Throws if not.
 * @param {string} candidatePath
 * @param {string} rootDir
 * @returns {string} resolved candidatePath
 */
function assertUnderRoot(candidatePath, rootDir) {
  const resolved = path.resolve(candidatePath);
  const root = path.resolve(rootDir);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error('Path escapes tenant root');
  }
  return resolved;
}

/**
 * Join root + segments and assert result stays under root.
 * @param {string} rootDir
 * @param {...string} segments
 */
function safeJoin(rootDir, ...segments) {
  const joined = path.join(rootDir, ...segments);
  return assertUnderRoot(joined, rootDir);
}

function randomUuidV4() {
  return crypto.randomUUID();
}

module.exports = {
  TENANT_USER_ID_RE,
  isMultiUser,
  volumeRoot,
  registryDbPath,
  tenantPaths,
  assertUnderRoot,
  safeJoin,
  randomUuidV4,
};
