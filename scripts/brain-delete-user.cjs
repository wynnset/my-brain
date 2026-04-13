#!/usr/bin/env node
/**
 * Remove a tenant: delete the row in registry.db and the tree users/<id>/{workspace,data}.
 *
 *   cd app && npm install && cd ..
 *   node scripts/brain-delete-user.cjs --login user@example.com        # preview only
 *   node scripts/brain-delete-user.cjs --login=user@example.com --yes  # = form avoids shell issues with @
 *   node scripts/brain-delete-user.cjs --login user@example.com --yes
 *   node scripts/brain-delete-user.cjs --user-id <uuid> --yes
 *   node scripts/brain-delete-user.cjs --list-users   # show logins + ids (read-only)
 *
 * Without --yes, prints what would be deleted and exits with code 1.
 *
 * Env: TENANT_VOLUME_ROOT or DB_DIR — must match server (Fly: /data).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function requireFromApp(name) {
  const p = path.join(__dirname, '..', 'app', 'node_modules', name);
  try {
    return require(p);
  } catch (_) {
    return require(name);
  }
}
const Database = requireFromApp('better-sqlite3');
const tenancy = require(path.join(__dirname, '..', 'app', 'tenancy-utils.js'));

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--login' || a.startsWith('--login=')) {
      const v = a.startsWith('--login=') ? a.slice('--login='.length) : argv[++i];
      o.login = v;
    } else if (a === '--user-id' || a.startsWith('--user-id=')) {
      const v = a.startsWith('--user-id=') ? a.slice('--user-id='.length) : argv[++i];
      o.userId = v;
    } else if (a === '--yes') o.yes = true;
    else if (a === '--list-users') o.listUsers = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`);
    else o._.push(a);
  }
  return o;
}

function volumeRoot() {
  const raw = (process.env.TENANT_VOLUME_ROOT || process.env.DB_DIR || path.join(__dirname, '..', 'data')).trim();
  return path.resolve(raw);
}

function registryPath() {
  return path.join(volumeRoot(), 'registry.db');
}

function main() {
  const args = parseArgs(process.argv);
  const vol = volumeRoot();
  const regPath = registryPath();

  if (args.login && args.userId) {
    console.error('Pass only one of --login or --user-id.');
    process.exit(1);
  }
  if (args.listUsers && (args.login || args.userId || args.yes)) {
    console.error('--list-users cannot be combined with --login, --user-id, or --yes.');
    process.exit(1);
  }
  if (!args.login && !args.userId && !args.listUsers) {
    console.error(`Usage:
  node scripts/brain-delete-user.cjs --login EMAIL           # preview (no changes)
  node scripts/brain-delete-user.cjs --login=EMAIL --yes      # = form is safest for @ in email
  node scripts/brain-delete-user.cjs --user-id UUID --yes
  node scripts/brain-delete-user.cjs --list-users            # show logins + ids

Volume root: ${vol}`);
    process.exit(1);
  }

  if (!fs.existsSync(regPath)) {
    console.error('Registry not found:', regPath);
    process.exit(1);
  }

  if (args.listUsers) {
    const regList = new Database(regPath, { readonly: true });
    try {
      const rows = regList.prepare('SELECT id, login, display_name FROM users ORDER BY login COLLATE NOCASE').all();
      if (!rows.length) console.log('(no users)');
      else {
        for (const r of rows) {
          console.log([r.login, r.id, r.display_name || ''].join('\t'));
        }
      }
    } finally {
      regList.close();
    }
    process.exit(0);
  }

  const reg = new Database(regPath);
  let row;
  try {
    if (args.userId) {
      const id = String(args.userId).trim();
      if (!tenancy.TENANT_USER_ID_RE.test(id)) {
        console.error('Invalid --user-id (expected UUID v4).');
        process.exit(1);
      }
      row = reg.prepare('SELECT id, login, display_name FROM users WHERE id = ?').get(id);
    } else {
      const login = String(args.login || '').trim();
      if (!login) {
        console.error('Missing --login value (use --login you@x.com or --login=you@x.com).');
        process.exit(1);
      }
      // Match registry column semantics (login is UNIQUE COLLATE NOCASE); LOWER covers older DBs without column collation.
      row = reg
        .prepare('SELECT id, login, display_name FROM users WHERE LOWER(TRIM(login)) = LOWER(TRIM(?))')
        .get(login);
    }
  } finally {
    reg.close();
  }

  if (!row) {
    if (args.login) {
      const login = String(args.login || '').trim();
      console.error(`No matching user in registry for login: ${JSON.stringify(login)}`);
      console.error(`Registry file: ${regPath}`);
      console.error('Try: --login=your@email (equals form) in case the shell broke the address, or use --user-id from sqlite.');
    } else {
      console.error('No matching user in registry.');
    }
    process.exit(1);
  }

  let tenantRoot;
  try {
    tenantRoot = tenancy.tenantPaths(row.id).root;
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  const existsOnDisk = fs.existsSync(tenantRoot);
  console.log('User:', row.login, row.display_name ? `(${row.display_name})` : '', '\nId:   ', row.id);
  console.log('Path: ', tenantRoot, existsOnDisk ? '' : '(not on disk)');

  if (!args.yes) {
    console.error('\nAdd --yes to permanently remove this user from the registry and delete their data directory.');
    process.exit(1);
  }

  if (existsOnDisk) {
    try {
      fs.rmSync(tenantRoot, { recursive: true, force: true });
      console.log('Removed directory:', tenantRoot);
    } catch (e) {
      console.error('Failed to remove directory (registry not changed):', tenantRoot);
      console.error(e.message || e);
      process.exit(1);
    }
  } else {
    console.log('No data directory on disk.');
  }

  const regRw = new Database(regPath);
  try {
    const info = regRw.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    if (info.changes !== 1) {
      console.error('DELETE did not affect exactly one row (data may already be removed).');
      process.exit(1);
    }
  } finally {
    regRw.close();
  }
  console.log('Removed registry row for', row.login);
  console.log('Done.');
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
