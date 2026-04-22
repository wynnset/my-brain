#!/usr/bin/env node
/**
 * Update per-user chat-credit limits in the registry database.
 *
 *   node scripts/brain-set-limits.cjs --login email@x.com [--daily-limit 10] [--monthly-limit 10]
 *   node scripts/brain-set-limits.cjs --id <uuid> --daily-limit 25
 *   node scripts/brain-set-limits.cjs --list                # every user with their current limits + usage
 *   node scripts/brain-set-limits.cjs --history email@x.com [--months 12]  # prior closed monthly cycles
 *
 * Limits are USD. Pass `--daily-limit 0` to disable the daily cap (a value of
 * 0 means "no limit" inside the server); same for --monthly-limit.
 *
 * Env: TENANT_VOLUME_ROOT or DB_DIR — must match the running server so we
 * edit the same registry.db. Setting a limit to a value below the user's
 * current spend will simply stop new chats until the next reset.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function requireFromApp(name) {
  const p = path.join(__dirname, '..', 'app', 'node_modules', name);
  try { return require(p); } catch (_) { return require(name); }
}
const Database = requireFromApp('better-sqlite3');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--login') o.login = argv[++i];
    else if (a === '--id') o.id = argv[++i];
    else if (a === '--daily-limit') o.daily = argv[++i];
    else if (a === '--monthly-limit') o.monthly = argv[++i];
    else if (a === '--list') o.list = true;
    else if (a === '--history') o.history = argv[++i];
    else if (a === '--months') o.months = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unknown arg ${a}`);
  }
  return o;
}

function volumeRoot() {
  const raw = (process.env.TENANT_VOLUME_ROOT || process.env.DB_DIR || path.join(repoRoot, 'data')).trim();
  return path.resolve(raw);
}

function registryPath() {
  return path.join(volumeRoot(), 'registry.db');
}

function parseLimit(raw, label) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).trim().replace(/^\$/, ''));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid --${label} value "${raw}" (expected a non-negative USD amount)`);
  }
  return n;
}

function fmtUsd(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : '—';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      'Usage:\n' +
        '  node scripts/brain-set-limits.cjs --login USER [--daily-limit USD] [--monthly-limit USD]\n' +
        '  node scripts/brain-set-limits.cjs --id UUID   [--daily-limit USD] [--monthly-limit USD]\n' +
        '  node scripts/brain-set-limits.cjs --list\n' +
        '  node scripts/brain-set-limits.cjs --history USER_OR_UUID [--months N]',
    );
    return;
  }

  const regPath = registryPath();
  if (!fs.existsSync(regPath)) {
    console.error(`registry.db not found at ${regPath}. Start the server in multi-user mode first.`);
    process.exit(1);
  }

  const db = new Database(regPath);
  try {
    // user_usage_history may not exist on older registries; if the runtime
    // migration hasn't run yet, fall back to "no history" instead of crashing
    // the CLI.
    const hasHistory = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_usage_history'`)
      .get();

    if (args.list) {
      const rows = db
        .prepare(
          `SELECT u.id, u.login, u.display_name, u.daily_limit_usd, u.monthly_limit_usd,
                  uu.day_spend_usd, uu.month_spend_usd, uu.day_key, uu.month_period_start
             FROM users u
             LEFT JOIN user_usage uu ON uu.user_id = u.id
             ORDER BY u.login COLLATE NOCASE`,
        )
        .all();
      if (!rows.length) {
        console.log('No users in registry.');
        return;
      }
      const recentHistStmt = hasHistory
        ? db.prepare(
            `SELECT period_start, spend_usd FROM user_usage_history
               WHERE user_id = ? ORDER BY period_start DESC LIMIT 3`,
          )
        : null;
      for (const r of rows) {
        console.log(
          `- ${r.login.padEnd(32)} id=${r.id}  ` +
            `daily ${fmtUsd(r.day_spend_usd)}/${fmtUsd(r.daily_limit_usd)} (day ${r.day_key || '—'})  ` +
            `month ${fmtUsd(r.month_spend_usd)}/${fmtUsd(r.monthly_limit_usd)} (since ${r.month_period_start || '—'})`,
        );
        if (recentHistStmt) {
          const hist = recentHistStmt.all(r.id);
          if (hist.length) {
            const parts = hist.map((h) => `${h.period_start} ${fmtUsd(h.spend_usd)}`);
            console.log(`    previous months: ${parts.join('  •  ')}`);
          }
        }
      }
      return;
    }

    if (args.history) {
      if (!hasHistory) {
        console.log('No user_usage_history table yet (registry has not rolled over any monthly cycles).');
        return;
      }
      const ident = String(args.history).trim();
      const user = db
        .prepare('SELECT id, login FROM users WHERE id = ? OR login = ? COLLATE NOCASE')
        .get(ident, ident);
      if (!user) {
        console.error('No user found for', ident);
        process.exit(1);
      }
      const limit = Math.max(1, Math.min(120, Number(args.months) || 12));
      const rows = db
        .prepare(
          `SELECT period_start, period_end, spend_usd, closed_at
             FROM user_usage_history
             WHERE user_id = ?
             ORDER BY period_start DESC
             LIMIT ?`,
        )
        .all(user.id, limit);
      if (!rows.length) {
        console.log(`${user.login}: no closed monthly cycles yet.`);
        return;
      }
      console.log(`${user.login} — last ${rows.length} closed monthly cycles:`);
      for (const r of rows) {
        console.log(
          `  ${r.period_start} → ${r.period_end}   spend ${fmtUsd(r.spend_usd)}   closed ${r.closed_at}`,
        );
      }
      return;
    }

    const daily = parseLimit(args.daily, 'daily-limit');
    const monthly = parseLimit(args.monthly, 'monthly-limit');
    if (daily == null && monthly == null) {
      console.error('Pass at least one of --daily-limit / --monthly-limit (or --list / --history to inspect).');
      process.exit(1);
    }

    let row;
    if (args.id) {
      row = db.prepare('SELECT id, login FROM users WHERE id = ?').get(String(args.id).trim());
    } else if (args.login) {
      row = db
        .prepare('SELECT id, login FROM users WHERE login = ? COLLATE NOCASE')
        .get(String(args.login).trim());
    } else {
      console.error('Specify --login or --id (or --list / --history).');
      process.exit(1);
    }
    if (!row) {
      console.error('No user found for', args.id || args.login);
      process.exit(1);
    }

    const sets = [];
    const vals = [];
    if (daily != null) { sets.push('daily_limit_usd = ?'); vals.push(daily); }
    if (monthly != null) { sets.push('monthly_limit_usd = ?'); vals.push(monthly); }
    vals.push(row.id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    const after = db
      .prepare('SELECT daily_limit_usd, monthly_limit_usd FROM users WHERE id = ?')
      .get(row.id);
    console.log(
      `OK updated ${row.login}: daily ${fmtUsd(after.daily_limit_usd)}, monthly ${fmtUsd(after.monthly_limit_usd)}`,
    );
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
