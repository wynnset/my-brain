'use strict';

const path = require('path');
const Database = require('better-sqlite3');

function registerDbApiRoutes(app, ctx) {
  const { safeTenantSqliteBase } = ctx;

  app.post('/api/db', (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: 'Unauthorized' });

    const { db: dbName, sql } = req.body;
    if (!dbName || !sql) return res.status(400).json({ error: 'Missing db or sql' });
    const dbBase = safeTenantSqliteBase(dbName);
    if (!dbBase) return res.status(400).json({ error: 'Invalid db name' });

    try {
      const dataDir = req.tenant.dataDir;
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
