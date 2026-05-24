'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

function assertSelectOnly(sql) {
  const s = String(sql || '').trim().replace(/^\s*\/\*[\s\S]*?\*\/\s*/gm, '').trim();
  if (!/^select\b/i.test(s)) throw new Error('Only SELECT statements are allowed');
  if (/\b(insert|update|delete|drop|alter|pragma|attach|detach|replace|create|truncate|vacuum|reindex)\b/i.test(s)) {
    throw new Error('SQL contains a forbidden keyword');
  }
}

function assertDmlOnly(sql) {
  const s = String(sql || '').trim().replace(/^\s*\/\*[\s\S]*?\*\/\s*/gm, '').trim();
  if (/^\s*select\b/i.test(s)) throw new Error('Use brain_select for SELECT queries');
  if (/\b(drop|alter|truncate|vacuum|reindex|attach|detach|pragma|create)\b/i.test(s)) {
    throw new Error('SQL contains a forbidden keyword');
  }
}

const SYSTEM_FILE_NAMES = new Set(['brain.db', 'finance.db', 'launchpad.db', 'wynnset.db', 'config.json', 'dashboard.json']);

function safeUnderDir(base, rel) {
  const resolved = path.resolve(path.join(base, rel));
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}

function buildMcpServer(tenant) {
  const server = new McpServer({ name: 'brain', version: '1.0.0' });
  const { dataDir, workspaceDir } = tenant;

  server.registerTool(
    'brain_select',
    {
      title: 'Query a database',
      description:
        'Run a read-only SELECT on a tenant SQLite database. ' +
        'db must be one of: brain (action items), launchpad (job search / tasks), finance, wynnset (corporate accounting).',
      inputSchema: z.object({
        db: z.enum(['brain', 'launchpad', 'finance', 'wynnset']),
        sql: z.string().max(8000),
      }),
    },
    async ({ db, sql }) => {
      assertSelectOnly(sql);
      const dbPath = path.join(dataDir, `${db}.db`);
      if (!fs.existsSync(dbPath)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `${db}.db not found` }) }], isError: true };
      }
      const database = new Database(dbPath, { readonly: true });
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

  server.registerTool(
    'list_chat_sessions',
    {
      title: 'List chat sessions',
      description: 'List all chat sessions with title, agent name, message count, and timestamps. Sorted newest first.',
      inputSchema: z.object({}),
    },
    async () => {
      const sessDir = path.join(dataDir, 'chat-sessions');
      if (!fs.existsSync(sessDir)) return { content: [{ type: 'text', text: '[]' }] };
      const sessions = [];
      for (const f of fs.readdirSync(sessDir).filter((n) => n.endsWith('.json'))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(sessDir, f), 'utf8'));
          sessions.push({
            id: s.id,
            title: s.title,
            agent: s.agent,
            messageCount: (s.messages || []).length,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          });
        } catch (_) {}
      }
      sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
    },
  );

  server.registerTool(
    'read_chat_session',
    {
      title: 'Read a chat session',
      description: 'Read the full message history of a chat session by its ID.',
      inputSchema: z.object({
        id: z.string().regex(/^[0-9a-f-]{36}$/i),
      }),
    },
    async ({ id }) => {
      const sessPath = path.join(dataDir, 'chat-sessions', `${id}.json`);
      if (!fs.existsSync(sessPath)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }], isError: true };
      }
      let text = fs.readFileSync(sessPath, 'utf8');
      if (text.length > 100000) text = `${text.slice(0, 100000)}\n…(truncated)`;
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'list_workspace_files',
    {
      title: 'List workspace files',
      description:
        'List files and directories in the workspace (CYRUS.md, memory/, docs/, team/, owners-inbox/, etc.). ' +
        'Pass subdir to list a specific subdirectory.',
      inputSchema: z.object({
        subdir: z.string().optional(),
      }),
    },
    async ({ subdir } = {}) => {
      const target = subdir ? safeUnderDir(workspaceDir, subdir) : workspaceDir;
      if (!target) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid path' }) }], isError: true };
      }
      if (!fs.existsSync(target)) return { content: [{ type: 'text', text: '[]' }] };

      const entries = [];
      function walk(dir, rel) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue;
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) {
            entries.push({ type: 'dir', path: relPath });
            walk(path.join(dir, e.name), relPath);
          } else {
            entries.push({ type: 'file', path: relPath, size: fs.statSync(path.join(dir, e.name)).size });
          }
        }
      }
      walk(target, '');
      return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
    },
  );

  server.registerTool(
    'read_workspace_file',
    {
      title: 'Read a workspace file',
      description: 'Read the text content of a file in the workspace. Path is relative to the workspace root (e.g. "CYRUS.md", "memory/user.md").',
      inputSchema: z.object({
        path: z.string(),
      }),
    },
    async ({ path: relPath }) => {
      const resolved = safeUnderDir(workspaceDir, relPath);
      if (!resolved) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid path' }) }], isError: true };
      }
      if (!fs.existsSync(resolved)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'File not found' }) }], isError: true };
      }
      let text = fs.readFileSync(resolved, 'utf8');
      if (text.length > 100000) text = `${text.slice(0, 100000)}\n…(truncated)`;
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'brain_execute',
    {
      title: 'Write to a database',
      description:
        'Run an INSERT, UPDATE, DELETE, or REPLACE statement on a tenant SQLite database. ' +
        'db must be one of: brain (action items), launchpad (job search / tasks), finance, wynnset (corporate accounting). ' +
        'Use params array for parameterized queries (? placeholders). Returns { changes, lastInsertRowid }.',
      inputSchema: z.object({
        db: z.enum(['brain', 'launchpad', 'finance', 'wynnset']),
        sql: z.string().max(8000),
      }),
    },
    async ({ db, sql }) => {
      assertDmlOnly(sql);
      const dbPath = path.join(dataDir, `${db}.db`);
      if (!fs.existsSync(dbPath)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `${db}.db not found` }) }], isError: true };
      }
      const database = new Database(dbPath);
      try {
        const stmt = database.prepare(sql);
        const result = stmt.run();
        return {
          content: [{ type: 'text', text: JSON.stringify({ changes: result.changes, lastInsertRowid: String(result.lastInsertRowid) }) }],
        };
      } finally {
        database.close();
      }
    },
  );

  server.registerTool(
    'write_workspace_file',
    {
      title: 'Write a workspace file',
      description:
        'Create or overwrite a UTF-8 text file in the workspace. ' +
        'path is relative to the workspace root, e.g. "owners-inbox/ledger-2026-05-24-finance.md" or "memory/note.md". ' +
        'Parent directories are created automatically. ' +
        'Hidden files (starting with .) and system files (*.db, config.json) are blocked.',
      inputSchema: z.object({
        path: z.string().max(500),
        content: z.string().max(100000),
      }),
    },
    async ({ path: relPath, content }) => {
      const parts = relPath.split(/[/\\]/);
      if (parts.some((p) => p.startsWith('.'))) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Hidden files are not allowed' }) }], isError: true };
      }
      if (parts.length === 1 && SYSTEM_FILE_NAMES.has(parts[0])) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Cannot overwrite system file' }) }], isError: true };
      }
      const resolved = safeUnderDir(workspaceDir, relPath);
      if (!resolved || resolved === workspaceDir) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid path' }) }], isError: true };
      }
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf8');
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: relPath }) }] };
    },
  );

  return server;
}

function registerMcpRoutes(app) {
  // GET: reachability check — must return 200 so claude.ai accepts the URL
  app.get('/mcp', (req, res) => {
    res.json({ name: 'brain', version: '1.0.0', transport: 'streamable-http' });
  });

  // POST: actual MCP protocol — requires Bearer token
  app.post('/mcp', async (req, res) => {
    if (!req.tenant) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Unauthorized', error_description: 'Bearer token required' });
    }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildMcpServer(req.tenant);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp]', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
    }
  });

  // DELETE: session teardown (stateless — nothing to clean up)
  app.delete('/mcp', (req, res) => res.status(204).end());
}

module.exports = { registerMcpRoutes };
