'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function openDbReadonly(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return new Database(filePath, { readonly: true });
  } catch (err) {
    console.error(`Failed to open database ${filePath}:`, err.message);
    return null;
  }
}

/**
 * Open domain DBs for a tenant (missing files are null). Caller must call close() when done.
 * @param {string} dataDir
 */
function openTenantDatabases(dataDir) {
  const brain = openDbReadonly(path.join(dataDir, 'brain.db'));
  const launchpad = openDbReadonly(path.join(dataDir, 'launchpad.db'));
  const finance = openDbReadonly(path.join(dataDir, 'finance.db'));
  const wynnset = openDbReadonly(path.join(dataDir, 'wynnset.db'));
  return {
    brain,
    launchpad,
    finance,
    wynnset,
    close() {
      for (const db of [brain, launchpad, finance, wynnset]) {
        if (db) try { db.close(); } catch (_) {}
      }
    },
    ready() {
      return Boolean(brain);
    },
  };
}

function migrateBrainActionItemsDetails(dataDir) {
  const p = path.join(dataDir, 'brain.db');
  if (!fs.existsSync(p)) return;
  let rw;
  try {
    rw = new Database(p);
    const names = new Set(rw.prepare(`PRAGMA table_info(action_items)`).all().map((c) => c.name));
    if (!names.has('details')) {
      rw.exec(`ALTER TABLE action_items ADD COLUMN details TEXT`);
      console.log(`brain.db: added column action_items.details (${dataDir})`);
    }
  } catch (err) {
    console.warn('brain.db migration (action_items.details):', err.message);
  } finally {
    if (rw) try { rw.close(); } catch (_) {}
  }
}

module.exports = {
  openTenantDatabases,
  migrateBrainActionItemsDetails,
};
