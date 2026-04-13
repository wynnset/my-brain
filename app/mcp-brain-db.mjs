/**
 * stdio MCP server: read-only SELECT against Cyrus SQLite DBs.
 * Started by Claude Agent SDK when BRAIN_CHAT_MCP_DB=1.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB_DIR = process.env.BRAIN_MCP_DB_DIR || process.env.DB_DIR || '.';
const DB_BASE_RE = /^[a-z][a-z0-9_-]{0,62}$/i;
const DB_BLOCKLIST = new Set(['registry']);

function normalizeDbBase(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\.db$/i, '');
  if (!DB_BASE_RE.test(s)) return null;
  if (DB_BLOCKLIST.has(s.toLowerCase())) return null;
  return s;
}

function assertSelectOnly(sql) {
  let s = String(sql || '').trim();
  s = s.replace(/^\s*\/\*[\s\S]*?\*\/\s*/gm, '').trim();
  if (!/^select\b/i.test(s)) throw new Error('Only SELECT statements are allowed');
  if (/\b(insert|update|delete|drop|alter|pragma|attach|detach|replace|create|truncate|vacuum|reindex)\b/i.test(s)) {
    throw new Error('SQL contains a forbidden keyword');
  }
}

const server = new McpServer({ name: 'brain-db', version: '1.0.0' });

server.registerTool(
  'brain_select',
  {
    title: 'Read-only SQL',
    description:
      'Run a single SELECT on a tenant SQLite file (read-only). `db` is the basename without .db (e.g. brain, launchpad, or a custom DB created under the tenant data directory).',
    inputSchema: z.object({
      db: z.string().max(63),
      sql: z.string().max(12000),
    }),
  },
  async ({ db, sql }) => {
    assertSelectOnly(sql);
    const base = normalizeDbBase(db);
    if (!base) throw new Error('Invalid db name');
    const full = path.join(DB_DIR, `${base}.db`);
    if (!fs.existsSync(full)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Database file not found', path: full }) }],
        isError: true,
      };
    }
    const database = new Database(full, { readonly: true });
    try {
      const rows = database.prepare(sql).all();
      let text = JSON.stringify(rows, null, 2);
      if (text.length > 80000) text = `${text.slice(0, 80000)}\n…(truncated)`;
      return { content: [{ type: 'text', text }] };
    } finally {
      database.close();
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
