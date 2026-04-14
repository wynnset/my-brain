'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function restoreEnv(keys, snapshot) {
  for (const k of keys) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

test('resolveLegacyWorkspaceRoot: DATA_DIR wins when different from vol', () => {
  const { resolveLegacyWorkspaceRoot } = require('./volume-migrate.js');
  const keys = ['DATA_DIR', 'LEGACY_WORKSPACE_DIR'];
  const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    delete process.env.LEGACY_WORKSPACE_DIR;
    process.env.DATA_DIR = '/app/repo';
    assert.strictEqual(resolveLegacyWorkspaceRoot('/app/repo/data'), '/app/repo');
  } finally {
    restoreEnv(keys, snap);
  }
});

test('resolveLegacyWorkspaceRoot: parent of …/data when CYRUS at parent', () => {
  const { resolveLegacyWorkspaceRoot } = require('./volume-migrate.js');
  const keys = ['DATA_DIR', 'LEGACY_WORKSPACE_DIR'];
  const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-'));
  try {
    delete process.env.LEGACY_WORKSPACE_DIR;
    delete process.env.DATA_DIR;
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'CYRUS.md'), '# x', 'utf8');
    const vol = path.join(tmp, 'data');
    assert.strictEqual(resolveLegacyWorkspaceRoot(vol), tmp);
  } finally {
    restoreEnv(keys, snap);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
