'use strict';

function q(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    console.error('Query error:', err.message, '\nSQL:', sql);
    return [];
  }
}

function q1(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params) || null;
  } catch (err) {
    console.error('Query error:', err.message, '\nSQL:', sql);
    return null;
  }
}

module.exports = { q, q1 };
