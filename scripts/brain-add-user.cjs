#!/usr/bin/env node
/**
 * Provision a tenant: registry row + users/<id>/{workspace,data}.
 *
 *   cd app && npm install && cd ..
 *   node scripts/brain-add-user.cjs
 *     (prompts for email, password, and optional display name when --login / --password omitted)
 *
 *   node scripts/brain-add-user.cjs --login email@x.com --password 'secret' [--name "Display Name"] [--full-team] [--seed-dbs DIR]
 *     [--daily-limit USD] [--monthly-limit USD]
 *
 *   Every new tenant gets starter team files: vesta, dara, sylvan, arc (from tenant-defaults/team, with fallback to docker-seed/team).
 *   Default chat-credit limits: $10 daily / $10 monthly (override via --daily-limit / --monthly-limit, or later via
 *   scripts/brain-set-limits.cjs).
 *
 *   --claim-legacy ONLY after the server migrated a flat volume (it writes .legacy-tenant-uuid).
 *   New tenants get brain.db only (from brain.sql under --seed-dbs / BRAIN_SEED_DBS / ./data, merged with docker-seed/).
 *   Other SQLite files (launchpad, finance, wynnset, or custom) can be created later via POST /api/db or sqlite.
 *
 * Env: TENANT_VOLUME_ROOT or DB_DIR — must match server (Fly: /data).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline/promises');

function requireFromApp(name) {
  const p = path.join(__dirname, '..', 'app', 'node_modules', name);
  try {
    return require(p);
  } catch (_) {
    return require(name);
  }
}
const Database = requireFromApp('better-sqlite3');
const bcrypt = requireFromApp('bcrypt');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--login') o.login = argv[++i];
    else if (a === '--password') o.password = argv[++i];
    else if (a === '--seed-dbs') o.seedDbs = argv[++i];
    else if (a === '--full-team') o.fullTeam = true;
    else if (a === '--claim-legacy') o.claimLegacy = true;
    else if (a === '--api-token') o.apiToken = argv[++i];
    else if (a === '--name') o.name = argv[++i];
    else if (a === '--daily-limit') o.dailyLimitUsd = argv[++i];
    else if (a === '--monthly-limit') o.monthlyLimitUsd = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`);
    else o._.push(a);
  }
  return o;
}

/** Password line; hidden on a TTY, plain readline when piped. */
async function readPassword(label) {
  const stdout = process.stdout;
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: stdout });
    try {
      return (await rl.question(`${label}: `)).trim();
    } finally {
      rl.close();
    }
  }
  stdout.write(`${label}: `);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let s = '';
    const onData = (chunk) => {
      const str = chunk.toString('utf8');
      for (const ch of str) {
        const c = ch.codePointAt(0);
        if (c === 3) {
          cleanup();
          stdout.write('\n');
          process.exit(130);
        }
        if (c === 13 || c === 10) {
          cleanup();
          stdout.write('\n');
          resolve(s.trim());
          return;
        }
        if (c === 127 || c === 8) {
          s = s.slice(0, -1);
          continue;
        }
        if (c >= 32) s += ch;
      }
    };
    function cleanup() {
      stdin.setRawMode(false);
      stdin.removeListener('data', onData);
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** Fill missing login / password / name from the terminal (name only when already prompting). */
async function promptForCredentials(args) {
  const needsLogin = !args.login;
  const needsPassword = !args.password;
  if (!needsLogin && !needsPassword) return;

  const needsNamePrompt = args.name === undefined;

  const stdout = process.stdout;
  const rl = readline.createInterface({ input: process.stdin, output: stdout });
  try {
    if (needsLogin) {
      args.login = (await rl.question('Email (login): ')).trim();
    }
  } finally {
    rl.close();
  }

  if (needsPassword) {
    args.password = await readPassword('Password');
  }

  if (needsNamePrompt) {
    const derived = deriveDisplayName(args.login, '');
    const hint = derived && derived !== 'User' ? ` [Enter = "${derived}"]` : '';
    const rl2 = readline.createInterface({ input: process.stdin, output: stdout });
    try {
      const line = (await rl2.question(`Display name (optional)${hint}: `)).trim();
      if (line) args.name = line;
    } finally {
      rl2.close();
    }
  }
}

function volumeRoot() {
  const raw = (process.env.TENANT_VOLUME_ROOT || process.env.DB_DIR || path.join(repoRoot, 'data')).trim();
  return path.resolve(raw);
}

function registryPath() {
  return path.join(volumeRoot(), 'registry.db');
}

function registrySqlPath() {
  const candidates = [
    path.join(repoRoot, 'data', 'registry.sql'),
    path.join(repoRoot, 'app', 'data', 'registry.sql'),
    path.join(repoRoot, 'docker-seed', 'registry.sql'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`registry.sql not found (tried ${candidates.join('; ')})`);
}

function ensureRegistry() {
  const sqlPath = registrySqlPath();
  const reg = registryPath();
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  const db = new Database(reg);
  try {
    db.exec(fs.readFileSync(sqlPath, 'utf8'));
    // ALTER TABLE is not idempotent in SQLite — mirror the JS migration that
    // the running server applies on boot so this script can provision users
    // against a registry.db that predates the chat-credit-limit feature.
    const userCols = new Set(db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name));
    if (!userCols.has('daily_limit_usd')) {
      db.exec(`ALTER TABLE users ADD COLUMN daily_limit_usd REAL NOT NULL DEFAULT 10`);
    }
    if (!userCols.has('monthly_limit_usd')) {
      db.exec(`ALTER TABLE users ADD COLUMN monthly_limit_usd REAL NOT NULL DEFAULT 10`);
    }
  } finally {
    db.close();
  }
}

/** Parse a $-limit flag; fall back to null (keep column default) when absent. */
function parseLimitArg(raw, label) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).trim().replace(/^\$/, ''));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --${label} value "${raw}" (expected a non-negative USD amount)`);
  }
  return n;
}

function tenantDefaultsDir() {
  return path.join(repoRoot, 'tenant-defaults');
}

/** Human-readable name from login when --name is omitted (e.g. jane.doe@x.com → Jane Doe). */
function deriveDisplayName(login, explicitName) {
  const ex = String(explicitName || '').trim();
  if (ex) return ex.slice(0, 200);
  const l = String(login || '').trim();
  const at = l.indexOf('@');
  const local = (at > 0 ? l.slice(0, at) : l).replace(/[.+_-]+/g, ' ').trim();
  if (!local) return 'User';
  return local
    .split(/\s+/)
    .map((w) => {
      const t = w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase();
      return t;
    })
    .join(' ')
    .slice(0, 200);
}

function teamDirHasAgentMarkdown(teamDir) {
  if (!fs.existsSync(teamDir) || !fs.statSync(teamDir).isDirectory()) return false;
  return fs.readdirSync(teamDir).some((n) => n.endsWith('.md') && !n.startsWith('.'));
}

/** Shipped for every new tenant (hiring + DBs + sample writer). Order is not significant. */
const STARTER_TEAM_AGENTS = ['vesta', 'dara', 'sylvan', 'arc'];

function starterTeamAgentSourcePaths(defaultsDir, baseName) {
  return [
    path.join(defaultsDir, 'team', baseName),
    path.join(repoRoot, 'docker-seed', 'team', baseName),
  ];
}

function copyStarterTeamAgents(workspaceTeamDir, defaultsDir) {
  for (const agent of STARTER_TEAM_AGENTS) {
    const baseName = `${agent}.md`;
    let src = null;
    for (const p of starterTeamAgentSourcePaths(defaultsDir, baseName)) {
      if (fs.existsSync(p)) {
        src = p;
        break;
      }
    }
    if (!src) {
      throw new Error(
        `Missing starter team agent ${baseName} — add it under tenant-defaults/team/ or docker-seed/team/ in the repo.`,
      );
    }
    fs.copyFileSync(src, path.join(workspaceTeamDir, baseName));
  }
}

function writeOwnerProfileDoc(workspaceDir, displayName) {
  const body = [
    '# Workspace owner',
    '',
    `**Preferred name:** ${displayName}`,
    '',
    'Replace or extend this stub with background agents should know when drafting on your behalf (role, industry, goals, constraints, tone).',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(workspaceDir, 'docs', 'profile.md'), body, 'utf8');
}

/** Neutral templates only (see `tenant-defaults/`). Never copy repo-root CYRUS, `data/config`, or owner-specific docs. */
function seedWorkspace(workspaceDir, { fullTeam, displayName }) {
  const defaultsDir = tenantDefaultsDir();
  if (!fs.existsSync(defaultsDir) || !fs.statSync(defaultsDir).isDirectory()) {
    throw new Error(
      `Missing ${defaultsDir} — add the tenant-defaults folder from the repo (required for new tenant workspaces).`,
    );
  }
  fs.mkdirSync(path.join(workspaceDir, 'team'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'owners-inbox'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'team-inbox'), { recursive: true });

  const cyrusSrc = path.join(defaultsDir, 'CYRUS.md');
  if (!fs.existsSync(cyrusSrc)) throw new Error(`Missing ${cyrusSrc}`);
  fs.copyFileSync(cyrusSrc, path.join(workspaceDir, 'CYRUS.md'));

  const cfgSrc = path.join(defaultsDir, 'config.json');
  if (!fs.existsSync(cfgSrc)) throw new Error(`Missing ${cfgSrc}`);
  fs.copyFileSync(cfgSrc, path.join(workspaceDir, 'config.json'));

  const docsSrc = path.join(defaultsDir, 'docs');
  if (fs.existsSync(docsSrc) && fs.statSync(docsSrc).isDirectory()) {
    fs.cpSync(docsSrc, path.join(workspaceDir, 'docs'), { recursive: true });
  }
  writeOwnerProfileDoc(workspaceDir, displayName);

  copyStarterTeamAgents(path.join(workspaceDir, 'team'), defaultsDir);

  if (fullTeam) {
    const teamSrc = path.join(defaultsDir, 'team');
    if (teamDirHasAgentMarkdown(teamSrc)) {
      fs.cpSync(teamSrc, path.join(workspaceDir, 'team'), { recursive: true });
    } else {
      console.warn(
        '[brain-add-user] --full-team: no .md agents under tenant-defaults/team — skipping team copy. Add markdown agents there to ship a default team.',
      );
    }
  }
}

function seedDatabaseSearchDirs(primaryDir) {
  const primary = path.resolve(primaryDir);
  const dock = path.resolve(path.join(repoRoot, 'docker-seed'));
  const dirs = [];
  for (const d of [primary, dock]) {
    if (fs.existsSync(d) && !dirs.includes(d)) dirs.push(d);
  }
  return dirs;
}

function findSeedForDb(name, dirs) {
  for (const dir of dirs) {
    const sql = path.join(dir, `${name}.sql`);
    if (fs.existsSync(sql)) return { kind: 'sql', path: sql, dir };
  }
  for (const dir of dirs) {
    const dbf = path.join(dir, `${name}.db`);
    if (fs.existsSync(dbf)) return { kind: 'db', path: dbf, dir };
  }
  return null;
}

function seedDatabases(dataDir, primarySeedDir) {
  const dirs = seedDatabaseSearchDirs(primarySeedDir);
  if (dirs.length === 0) {
    throw new Error(`No seed directories found (primary ${path.resolve(primarySeedDir)} and docker-seed)`);
  }
  fs.mkdirSync(path.join(dataDir, 'chat-sessions'), { recursive: true });
  const found = findSeedForDb('brain', dirs);
  const out = path.join(dataDir, 'brain.db');
  if (!found) {
    throw new Error(
      `Missing brain.sql or brain.db in one of: ${dirs.join(' | ')} (use --seed-dbs or BRAIN_SEED_DBS for the first directory)`,
    );
  }
  if (found.kind === 'sql') {
    const db = new Database(out);
    try {
      db.exec(fs.readFileSync(found.path, 'utf8'));
    } finally {
      db.close();
    }
    console.log(`Created brain.db from ${path.relative(repoRoot, found.path)}`);
  } else {
    fs.copyFileSync(found.path, out);
    console.log(`Copied brain.db from ${path.relative(repoRoot, found.path)}`);
  }
}

function migrateBrainDetails(dataDir) {
  const p = path.join(dataDir, 'brain.db');
  if (!fs.existsSync(p)) return;
  let rw;
  try {
    rw = new Database(p);
    const names = new Set(rw.prepare(`PRAGMA table_info(action_items)`).all().map((c) => c.name));
    if (!names.has('details')) {
      rw.exec(`ALTER TABLE action_items ADD COLUMN details TEXT`);
    }
  } finally {
    if (rw) try { rw.close(); } catch (_) {}
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const usage = `Usage (new tenant — omit --claim-legacy):
  node scripts/brain-add-user.cjs
    (interactive: email, password, optional name)
  node scripts/brain-add-user.cjs --login USER --password PASS [--name "Display Name"] [--full-team] [--seed-dbs DIR]

After a server-side flat-volume migration only:
  node scripts/brain-add-user.cjs --claim-legacy [--login USER --password PASS]
    (omit flags to be prompted)`;

  await promptForCredentials(args);

  if (!args.login || !args.password) {
    console.error(usage);
    process.exit(1);
  }

  const vol = volumeRoot();
  ensureRegistry();
  const displayName = deriveDisplayName(args.login, args.name);

  let userId;
  if (args.claimLegacy) {
    const legacyFile = path.join(vol, '.legacy-tenant-uuid');
    if (!fs.existsSync(legacyFile)) {
      console.error(
        'No .legacy-tenant-uuid in this volume — nothing to claim.\n' +
          '  --claim-legacy is only for the one-time step AFTER the server moved an old flat /data layout ' +
          'into users/<uuid>/ (see server boot / migrate logs).\n' +
          '  To add a normal user, run WITHOUT --claim-legacy, e.g.:\n' +
          `    node scripts/brain-add-user.cjs --login YOUR_EMAIL --password '…'\n` +
          `  Volume root in use: ${vol}`,
      );
      process.exit(1);
    }
    userId = fs.readFileSync(legacyFile, 'utf8').trim();
    fs.unlinkSync(legacyFile);
    console.log('Claiming legacy tenant', userId);
  } else {
    userId = crypto.randomUUID();
  }

  const base = path.join(vol, 'users', userId);
  const workspaceDir = path.join(base, 'workspace');
  const dataDir = path.join(base, 'data');

  if (args.claimLegacy) {
    if (!fs.existsSync(dataDir) || !fs.existsSync(path.join(dataDir, 'brain.db'))) {
      console.error('Legacy tenant data missing under', dataDir);
      process.exit(1);
    }
  } else if (fs.existsSync(base)) {
    console.error('Tenant path already exists:', base);
    process.exit(1);
  }

  if (!args.claimLegacy) {
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'chat-sessions'), { recursive: true });
    const primarySeed = args.seedDbs || process.env.BRAIN_SEED_DBS || path.join(repoRoot, 'data');
    seedDatabases(dataDir, primarySeed);
    migrateBrainDetails(dataDir);
    seedWorkspace(workspaceDir, { fullTeam: Boolean(args.fullTeam), displayName });
  }

  const dailyLimitUsd = parseLimitArg(args.dailyLimitUsd, 'daily-limit');
  const monthlyLimitUsd = parseLimitArg(args.monthlyLimitUsd, 'monthly-limit');

  const hash = await bcrypt.hash(args.password, 12);
  const reg = new Database(registryPath());
  try {
    const apiToken = args.apiToken ? String(args.apiToken).trim() : null;
    const cols = ['id', 'login', 'password_hash', 'api_token', 'display_name'];
    const vals = [userId, args.login.trim(), hash, apiToken, displayName];
    if (dailyLimitUsd != null) { cols.push('daily_limit_usd'); vals.push(dailyLimitUsd); }
    if (monthlyLimitUsd != null) { cols.push('monthly_limit_usd'); vals.push(monthlyLimitUsd); }
    reg.prepare(
      `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ).run(...vals);

    // Seed the usage row so the first chat request does not race to create it.
    // Cycle starts today (UTC) — the monthly reset anchor is the account
    // creation day-of-month, which is "today" for a brand-new user.
    const now = new Date();
    const dayKey = (() => {
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, '0');
      const d = String(now.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();
    reg.prepare(
      `INSERT OR IGNORE INTO user_usage (user_id, day_key, day_spend_usd, month_period_start, month_spend_usd)
       VALUES (?, ?, 0, ?, 0)`,
    ).run(userId, dayKey, dayKey);

    const limitsRow = reg
      .prepare('SELECT daily_limit_usd, monthly_limit_usd FROM users WHERE id = ?')
      .get(userId);
    console.log(
      `Limits: daily $${Number(limitsRow.daily_limit_usd).toFixed(2)}, monthly $${Number(limitsRow.monthly_limit_usd).toFixed(2)}`,
    );
  } finally {
    reg.close();
  }

  console.log('OK user', args.login, `(${displayName})`, 'id', userId);
  console.log('Workspace:', workspaceDir);
  console.log('Data:', dataDir);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
