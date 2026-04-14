'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { assertUnderRoot, safeJoin, tenantPaths, TENANT_USER_ID_RE } = require('./tenancy-utils.js');

test('TENANT_USER_ID_RE accepts v4 uuid', () => {
  assert.ok(TENANT_USER_ID_RE.test('550e8400-e29b-41d4-a716-446655440000'));
  assert.ok(!TENANT_USER_ID_RE.test('not-a-uuid'));
});

test('tenantPaths throws on invalid id', () => {
  assert.throws(() => tenantPaths('../evil'), /Invalid tenant/);
});

test('assertUnderRoot allows file inside root', () => {
  const root = path.resolve('/data/users/u1/workspace');
  const inner = path.join(root, 'team', 'x.md');
  assert.strictEqual(assertUnderRoot(inner, root), path.resolve(inner));
});

test('assertUnderRoot rejects traversal', () => {
  const root = path.resolve('/data/users/u1/workspace');
  const evil = path.join(root, '..', '..', 'registry.db');
  assert.throws(() => assertUnderRoot(evil, root), /escapes/);
});

test('safeJoin rejects traversal in segment', () => {
  const root = path.resolve('/tmp/t');
  assert.throws(() => safeJoin(root, '..', 'etc'), /escapes/);
});
