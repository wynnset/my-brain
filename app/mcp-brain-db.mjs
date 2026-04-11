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
const ALLOWED = new Set(['brain', 'launchpad', 'finance', 'wynnset']);

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
      'Run a single SELECT on brain.db, launchpad.db, finance.db, or wynnset.db (read-only). Use views such as v_open_action_items when helpful.',
    inputSchema: z.object({
      db: z.enum(['brain', 'launchpad', 'finance', 'wynnset']),
      sql: z.string().max(12000),
    }),
  },
  async ({ db, sql }) => {
    assertSelectOnly(sql);
    if (!ALLOWED.has(db)) throw new Error('Invalid db');
    const full = path.join(DB_DIR, `${db}.db`);
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
