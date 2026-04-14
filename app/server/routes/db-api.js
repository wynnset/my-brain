'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const session = require('../lib/session.js');

function registerDbApiRoutes(app, ctx) {
  const { safeTenantSqliteBase, DB_DIR, tenantDataDirForRequest } = ctx;

  app.post('/api/db', (req, res) => {
    if (session.multiUserMode()) {
      if (!req.tenant) return res.status(401).json({ error: 'Unauthorized' });
    } else {
      const token = (req.headers['authorization'] || '').replace('Bearer ', '');
      if (!process.env.BRAIN_API_TOKEN || token !== process.env.BRAIN_API_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { db: dbName, sql } = req.body;
    if (!dbName || !sql) return res.status(400).json({ error: 'Missing db or sql' });
    const dbBase = safeTenantSqliteBase(dbName);
    if (!dbBase) return res.status(400).json({ error: 'Invalid db name' });

    try {
      const dataDir = session.multiUserMode() ? req.tenant.dataDir : DB_DIR;
      const writable = new Database(path.join(dataDir, `${dbBase}.db`));
      const stmt = writable.prepare(sql);
      const result = stmt.reader ? stmt.all() : stmt.run();
      writable.close();
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerDbApiRoutes };
