'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function resolveRegistrySqlPath() {
  const candidates = [
    path.join(__dirname, '..', 'data', 'registry.sql'),
    path.join(__dirname, 'data', 'registry.sql'),
    path.join(__dirname, '..', 'docker-seed', 'registry.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`registry.sql not found (tried ${candidates.join(', ')})`);
}

function ensureRegistrySchema(registryPath) {
  const dir = path.dirname(registryPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sqlPath = resolveRegistrySqlPath();
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const db = new Database(registryPath);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

function openRegistryReadWrite(registryPath) {
  return new Database(registryPath);
}

/** @param {import('better-sqlite3').Database} db */
function findUserByLogin(db, login) {
  const row = db
    .prepare('SELECT id, login, password_hash, api_token, display_name FROM users WHERE login = ? COLLATE NOCASE')
    .get(String(login || '').trim());
  return row || null;
}

/** @param {import('better-sqlite3').Database} db */
function findUserByApiToken(db, token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return db.prepare('SELECT id, login, password_hash, api_token, display_name FROM users WHERE api_token = ?').get(t) || null;
}

/** Login + display name for dashboard (no secrets). */
function findUserSessionSummary(db, id) {
  const row = db.prepare('SELECT login, display_name FROM users WHERE id = ?').get(String(id || '').trim());
  return row || null;
}

module.exports = {
  ensureRegistrySchema,
  openRegistryReadWrite,
  findUserByLogin,
  findUserByApiToken,
  findUserSessionSummary,
};
