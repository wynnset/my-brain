'use strict';

const express  = require('express');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { spawn }  = require('child_process');
const multer   = require('multer');

const SESS_COOKIE = 'brain_sess';
const SESS_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days

function dashboardAuthEnabled() {
  return Boolean(process.env.DASHBOARD_PASSWORD);
}

function sessionSigningKey() {
  return crypto.createHmac('sha256', 'brain-dashboard-sess-v1')
    .update(process.env.DASHBOARD_PASSWORD)
    .digest();
}

function signSessionPayload(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSigningKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionCookie(cookieHeader) {
  if (!cookieHeader) return false;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESS_COOKIE}=([^;]+)`));
  if (!m) return false;
  const raw = decodeURIComponent(m[1].trim());
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return false;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', sessionSigningKey()).update(payloadB64).digest('base64url');
  try {
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return false;
  } catch (_) {
    return false;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return false;
  }
  if (!payload.exp || typeof payload.exp !== 'number') return false;
  return Math.floor(Date.now() / 1000) <= payload.exp;
}

function setSessionCookie(res, token, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESS_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [`${SESS_COOKIE}=`, 'HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const app     = express();
const PORT    = process.env.PORT || 3131;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_DIR   = process.env.DB_DIR   || path.join(__dirname, '..', 'data');

const ORCH_BRIEF_FILE = 'CYRUS.md';
const ORCH_BRIEF_LEGACY = 'LARRY.md';

/** Repo root (parent of `app/`); used when CYRUS.md lives outside DATA_DIR (common in local dev). */
const REPO_ROOT_DIR = path.join(__dirname, '..');

function orchestratorBriefRoots() {
  const roots = [DATA_DIR, REPO_ROOT_DIR];
  const seen = new Set();
  const out = [];
  for (const r of roots) {
    const norm = path.resolve(r);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

function ensureOrchestratorBriefMigrated() {
  for (const root of orchestratorBriefRoots()) {
    const cur = path.join(root, ORCH_BRIEF_FILE);
    const legacy = path.join(root, ORCH_BRIEF_LEGACY);
    if (!fs.existsSync(cur) && fs.existsSync(legacy)) {
      try {
        fs.renameSync(legacy, cur);
        console.log(`Renamed ${legacy} → ${cur}`);
      } catch (err) {
        console.warn('Orchestrator brief migration failed:', err.message);
      }
    }
  }
}
ensureOrchestratorBriefMigrated();

/** First existing orchestrator brief on disk (prefers CYRUS.md, then legacy LARRY.md). */
function resolveOrchestratorBriefPath() {
  for (const root of orchestratorBriefRoots()) {
    const c = path.join(root, ORCH_BRIEF_FILE);
    if (fs.existsSync(c)) return c;
  }
  for (const root of orchestratorBriefRoots()) {
    const l = path.join(root, ORCH_BRIEF_LEGACY);
    if (fs.existsSync(l)) return l;
  }
  return null;
}

/** Target path for writes / new file (same as resolved file if one exists, else DATA_DIR). */
function orchestratorBriefWritePath() {
  const found = resolveOrchestratorBriefPath();
  if (found) return found;
  return path.join(DATA_DIR, ORCH_BRIEF_FILE);
}

function isOrchestratorChatAgent(agent) {
  const a = String(agent || '').toLowerCase();
  return a === 'cyrus' || a === 'larry';
}

// ─── Open databases ───────────────────────────────────────────────────────────
let brain, launchpad, finance, wynnset;
function openDbReadonly(filename) {
  const p = path.join(DB_DIR, filename);
  if (!fs.existsSync(p)) {
    console.warn(`Database missing (ok for first boot): ${p}`);
    return null;
  }
  try {
    return new Database(p, { readonly: true });
  } catch (err) {
    console.error(`Failed to open database ${filename}:`, err.message);
    return null;
  }
}

/** Ensure optional markdown column exists (dashboard edits / richer notes). */
function migrateBrainActionItemsDetails() {
  const p = path.join(DB_DIR, 'brain.db');
  if (!fs.existsSync(p)) return;
  let rw;
  try {
    rw = new Database(p);
    const names = new Set(rw.prepare(`PRAGMA table_info(action_items)`).all().map((c) => c.name));
    if (!names.has('details')) {
      rw.exec(`ALTER TABLE action_items ADD COLUMN details TEXT`);
      console.log('brain.db: added column action_items.details');
    }
  } catch (err) {
    console.warn('brain.db migration (action_items.details):', err.message);
  } finally {
    if (rw) try { rw.close(); } catch (_) {}
  }
}
migrateBrainActionItemsDetails();

brain     = openDbReadonly('brain.db');
launchpad = openDbReadonly('launchpad.db');
finance   = openDbReadonly('finance.db');
wynnset   = openDbReadonly('wynnset.db');
const dbsReady = () => brain && launchpad && finance && wynnset;
if (dbsReady()) console.log('All databases opened successfully.');
else console.warn('Some databases missing — upload *.db to DB_DIR, then restart.');

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  [brain, launchpad, finance, wynnset].forEach(db => { if (db) try { db.close(); } catch (_) {} });
  console.log('\nDatabases closed. Goodbye.');
  process.exit(0);
});

// ─── Core middleware (static is mounted after auth, below) ───────────────────
app.use(express.json());

// ─── Public API ───────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/auth-status', (req, res) => {
  res.json({ loginRequired: dashboardAuthEnabled() });
});

app.post('/api/login', (req, res) => {
  if (!dashboardAuthEnabled()) {
    return res.status(400).json({ error: 'Dashboard login is not configured (set DASHBOARD_PASSWORD).' });
  }
  const password = (req.body && req.body.password) || '';
  if (password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const exp = Math.floor(Date.now() / 1000) + SESS_MAX_AGE_SEC;
  const token = signSessionPayload({ exp });
  setSessionCookie(res, token, SESS_MAX_AGE_SEC);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// When DASHBOARD_PASSWORD is set, require a valid session for everything except
// health, login, logout, and the login page.
app.use((req, res, next) => {
  if (!dashboardAuthEnabled()) return next();
  const p = req.path;
  if (p === '/login.html' && req.method === 'GET') return next();
  if ((p === '/api/db' || p === '/api/upload') && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (process.env.BRAIN_API_TOKEN && token === process.env.BRAIN_API_TOKEN) return next();
  }
  const cookie = req.headers.cookie || '';
  if (verifySessionCookie(cookie)) return next();
  if (p.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized', needsLogin: true });
  }
  if (req.method === 'GET' && req.accepts('html')) {
    return res.redirect(302, '/login.html');
  }
  return res.status(401).end();
});

// Dashboard aggregates need all four SQLite files (other /api routes use files or Claude only)
function pathNeedsAllDbs(url) {
  const p = url.split('?')[0];
  return p === '/api/dashboard' || p === '/api/career' || p === '/api/finance' || p === '/api/business';
}
app.use((req, res, next) => {
  if (!pathNeedsAllDbs(req.originalUrl)) return next();
  if (!dbsReady()) {
    return res.status(503).json({
      error: 'Database files missing on server',
      hint: 'Upload brain.db, launchpad.db, finance.db, wynnset.db to the volume under DB_DIR, then restart the machine.',
    });
  }
  next();
});

// ─── File upload (multer) ─────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(DATA_DIR, 'team-inbox'),
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const FILES_META_FILE = '.files-meta.json';
const META_STRING_MAX = 240;

function safeBrowseFileName(name) {
  if (!name || typeof name !== 'string') return null;
  const base = path.basename(name.trim());
  if (!base || base !== name.trim() || base.includes('..') || base.includes('/') || base.includes('\\'))
    return null;
  return base;
}

function sanitizeMetaString(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > META_STRING_MAX ? s.slice(0, META_STRING_MAX) : s;
}

function readFilesMetaMap(dirPath) {
  const p = path.join(dirPath, FILES_META_FILE);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
}

function writeFilesMetaMap(dirPath, map) {
  fs.writeFileSync(path.join(dirPath, FILES_META_FILE), JSON.stringify(map, null, 2), 'utf8');
}

function metaFieldsForFile(map, fileName) {
  const m = map[fileName] || {};
  return {
    createdBy: typeof m.createdBy === 'string' ? m.createdBy : '',
    domain: typeof m.domain === 'string' ? m.domain : '',
    category: typeof m.category === 'string' ? m.category : '',
  };
}

function attachMetaToEntries(dirPath, entries) {
  const map = readFilesMetaMap(dirPath);
  return entries.map((e) => {
    const x = metaFieldsForFile(map, e.name);
    return { ...e, createdBy: x.createdBy, domain: x.domain, category: x.category };
  });
}

/** Tags (createdBy / domain / category), PATCH meta, and archive only apply under these folders. */
const FILES_META_DIRS = new Set(['owners-inbox', 'team-inbox', 'docs']);

function entriesWithoutMeta(entries) {
  return entries.map((e) => ({
    ...e,
    createdBy: '',
    domain: '',
    category: '',
  }));
}

const UPLOAD_FILENAME_AGENT_IDS = new Set([
  'dash', 'scout', 'gauge', 'ledger', 'charter', 'arc', 'tailor', 'debrief',
  'relay', 'scribe', 'mirror', 'nolan', 'pax', 'frame', 'vela', 'cyrus',
]);

function inferAgentIdFromUploadFilename(filename) {
  const base = path.basename(String(filename || '')).toLowerCase();
  const m = base.match(/^([a-z][a-z0-9]*)[-_.]/);
  if (!m) return '';
  const id = m[1];
  return UPLOAD_FILENAME_AGENT_IDS.has(id) ? id : '';
}

function defaultUploadDomainForAgent(agentId) {
  const a = String(agentId || '').toLowerCase();
  if (a === 'ledger') return 'finance';
  if (a === 'charter') return 'business';
  if (a === 'owner') return 'personal';
  return 'career';
}

/** Resolves createdBy + domain for team-inbox uploads (multipart body and/or headers, then filename). */
function buildTeamInboxUploadMeta(filename, body, getHeader) {
  const b = body && typeof body === 'object' ? body : {};
  let createdBy = sanitizeMetaString(b.createdBy) || sanitizeMetaString(getHeader('x-created-by'));
  let domain = sanitizeMetaString(b.domain) || sanitizeMetaString(getHeader('x-file-domain'));
  let category = sanitizeMetaString(b.category) || sanitizeMetaString(getHeader('x-file-category'));
  if (!createdBy) createdBy = inferAgentIdFromUploadFilename(filename);
  if (!createdBy) createdBy = 'cyrus';
  if (!domain) domain = defaultUploadDomainForAgent(createdBy);
  const out = { createdBy, domain };
  if (category) out.category = category;
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

const DB_MAP = () => ({ brain, launchpad, finance, wynnset });

// ─── POST /api/db — write gate for local agents ───────────────────────────────
app.post('/api/db', (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!process.env.BRAIN_API_TOKEN || token !== process.env.BRAIN_API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { db: dbName, sql } = req.body;
  if (!dbName || !sql) return res.status(400).json({ error: 'Missing db or sql' });

  try {
    const writable = new Database(path.join(DB_DIR, `${dbName}.db`));
    const stmt = writable.prepare(sql);
    const result = stmt.reader ? stmt.all() : stmt.run();
    writable.close();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat sessions (JSON files under DB_DIR/chat-sessions) ───────────────────
const CHAT_SESSIONS_DIR = path.join(DB_DIR, 'chat-sessions');
const CHAT_LIST_LIMIT = 200;
const CHAT_HEARTBEAT_MS = Number(process.env.BRAIN_CHAT_HEARTBEAT_MS) || 20000;
const CHAT_MAX_TRANSCRIPT_CHARS = Number(process.env.BRAIN_CHAT_MAX_TRANSCRIPT_CHARS) || 100000;
const CHAT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureChatSessionsDir() {
  try {
    fs.mkdirSync(CHAT_SESSIONS_DIR, { recursive: true });
  } catch (err) {
    console.warn('[chat-sessions] mkdir', err.message);
  }
}

function chatSessionPath(id) {
  if (!CHAT_ID_RE.test(String(id || ''))) return null;
  return path.join(CHAT_SESSIONS_DIR, `${id}.json`);
}

function atomicWriteChatSession(filePath, obj) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, filePath);
}

function readChatSession(id) {
  const p = chatSessionPath(id);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!o || typeof o !== 'object' || !Array.isArray(o.messages)) return null;
    if (!o.id) o.id = id;
    return o;
  } catch (_) {
    return null;
  }
}

function formatTranscriptFromMessages(messages, maxChars) {
  const parts = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const label = m.role === 'user' ? 'User' : 'Assistant';
    parts.push(`${label}: ${String(m.content || '').trim()}`);
  }
  while (parts.length > 2) {
    let s = parts.join('\n\n');
    if (s.length <= maxChars) break;
    parts.shift();
  }
  let s = parts.join('\n\n');
  if (s.length > maxChars) {
    s = '…\n\n' + s.slice(-(maxChars - 4));
  }
  return s;
}

function titleFromPrompt(prompt) {
  const line = String(prompt || '').trim().replace(/\s+/g, ' ');
  if (!line) return 'Chat';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

// ─── POST /api/chat — spawn claude with agent system prompt ───────────────────
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

/** Fly has no macOS keychain; Claude needs an API key, bearer token, OAuth token, or cloud-provider env. */
function claudeAuthConfiguredOnFly() {
  if (!process.env.FLY_APP_NAME) return true;
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1' || process.env.CLAUDE_CODE_USE_VERTEX === '1') return true;
  if (normalizeAnthropicApiKey(process.env.ANTHROPIC_API_KEY)) return true;
  if ((process.env.ANTHROPIC_AUTH_TOKEN || '').trim()) return true;
  if ((process.env.CLAUDE_CODE_OAUTH_TOKEN || '').trim()) return true;
  return false;
}

/** Fly secrets / copy-paste sometimes include trailing newlines or wrapping quotes; Anthropic rejects the key or mis-bills. */
function normalizeAnthropicApiKey(raw) {
  if (raw == null || raw === '') return '';
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    s = s.slice(1, -1).trim();
  return s;
}

let flyClaudeIsolationEnsured = false;
/** Avoid /home/node/.claude credentials on the Fly VM overriding ANTHROPIC_API_KEY (subscription vs Console credits). */
function ensureFlyClaudeIsolation() {
  if (!process.env.FLY_APP_NAME || flyClaudeIsolationEnsured) return;
  flyClaudeIsolationEnsured = true;
  for (const dir of ['/tmp/brain-fake-home', '/tmp/brain-claude-config']) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn('[chat] could not mkdir', dir, err.message);
    }
  }
}

/** Env for the Claude CLI child. Anthropic docs: ANTHROPIC_AUTH_TOKEN is tried before ANTHROPIC_API_KEY; a stale bearer token causes bogus "credit balance" errors while the API key account is funded. */
function envForClaudeChat() {
  const env = { ...process.env };
  const apiKey = normalizeAnthropicApiKey(env.ANTHROPIC_API_KEY);
  const hasApiKey = Boolean(apiKey);
  if (hasApiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (hasApiKey && env.ANTHROPIC_AUTH_TOKEN && process.env.BRAIN_CHAT_KEEP_ANTHROPIC_AUTH_TOKEN !== '1') {
    delete env.ANTHROPIC_AUTH_TOKEN;
    console.log('[chat] ANTHROPIC_API_KEY is set; omitting ANTHROPIC_AUTH_TOKEN for child (bearer would override API key)');
  }
  if (!hasApiKey) {
    console.warn('[chat] ANTHROPIC_API_KEY is not set; Claude Code may use OAuth subscription auth instead of Console API credits');
  }
  if (process.env.FLY_APP_NAME) {
    ensureFlyClaudeIsolation();
    env.HOME = '/tmp/brain-fake-home';
    env.CLAUDE_CONFIG_DIR = '/tmp/brain-claude-config';
  }
  return env;
}

app.get('/api/chat/conversations', (req, res) => {
  ensureChatSessionsDir();
  let files = [];
  try {
    files = fs.readdirSync(CHAT_SESSIONS_DIR).filter(f => f.endsWith('.json'));
  } catch (_) {
    return res.json({ conversations: [] });
  }
  const items = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (!CHAT_ID_RE.test(id)) continue;
    const sess = readChatSession(id);
    if (!sess) continue;
    items.push({
      id: sess.id,
      agent: sess.agent,
      title: sess.title || 'Chat',
      updatedAt: sess.updatedAt || sess.createdAt,
    });
  }
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json({ conversations: items.slice(0, CHAT_LIST_LIMIT) });
});

app.post('/api/chat/conversations', (req, res) => {
  const agent = (req.body && req.body.agent) || '';
  if (!agent) return res.status(400).json({ error: 'Missing agent' });
  const systemFile = isOrchestratorChatAgent(agent)
    ? resolveOrchestratorBriefPath()
    : path.join(DATA_DIR, 'team', `${agent}.md`);
  if (!systemFile || !fs.existsSync(systemFile)) return res.status(404).json({ error: `Agent "${agent}" not found` });
  ensureChatSessionsDir();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sess = { id, agent, title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
  const p = chatSessionPath(id);
  atomicWriteChatSession(p, sess);
  res.json({ id });
});

app.get('/api/chat/conversations/:id', (req, res) => {
  const sess = readChatSession(req.params.id);
  if (!sess) return res.status(404).json({ error: 'Conversation not found' });
  res.json(sess);
});

app.delete('/api/chat/conversations/:id', (req, res) => {
  const p = chatSessionPath(req.params.id);
  if (!p) return res.status(400).json({ error: 'Invalid id' });
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  res.json({ ok: true });
});

app.post('/api/chat', (req, res) => {
  const { agent, prompt, conversationId } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Missing prompt' });
  if (!conversationId || !CHAT_ID_RE.test(String(conversationId))) {
    return res.status(400).json({ error: 'Missing or invalid conversationId' });
  }

  const sess = readChatSession(conversationId);
  if (!sess) return res.status(404).json({ error: 'Conversation not found' });

  const sessionAgent = sess.agent;
  if (agent && agent !== sessionAgent) {
    return res.status(400).json({ error: `Agent must match conversation (${sessionAgent})` });
  }

  const systemFile = isOrchestratorChatAgent(sessionAgent)
    ? resolveOrchestratorBriefPath()
    : path.join(DATA_DIR, 'team', `${sessionAgent}.md`);
  if (!systemFile || !fs.existsSync(systemFile)) return res.status(404).json({ error: `Agent "${sessionAgent}" not found` });

  if (!claudeAuthConfiguredOnFly()) {
    const flyApp = process.env.FLY_APP_NAME;
    return res.status(503).json({
      error:
        'Dashboard chat has no Anthropic credentials on this server (Fly does not use your laptop env). ' +
        `Run: fly secrets set ANTHROPIC_API_KEY="sk-ant-..." --app ${flyApp}`,
    });
  }

  let systemPrompt;
  try {
    systemPrompt = fs.readFileSync(systemFile, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `Could not read agent file: ${err.message}` });
  }

  const now = new Date().toISOString();
  const userMsg = {
    id: crypto.randomUUID(),
    role: 'user',
    content: String(prompt).trim(),
    createdAt: now,
  };
  sess.messages.push(userMsg);
  if (sess.messages.filter(m => m.role === 'user').length === 1) {
    sess.title = titleFromPrompt(prompt);
  }
  sess.updatedAt = now;
  try {
    atomicWriteChatSession(chatSessionPath(conversationId), sess);
  } catch (err) {
    sess.messages.pop();
    return res.status(500).json({ error: `Could not save message: ${err.message}` });
  }

  const transcript = formatTranscriptFromMessages(sess.messages, CHAT_MAX_TRANSCRIPT_CHARS);
  const fullPrompt = `${systemPrompt}\n\n---\n\n${transcript}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.log(`[chat] agent=${sessionAgent} conversation=${conversationId}`);

  const proc = spawn(CLAUDE_BIN, ['-p', '--dangerously-skip-permissions'], {
    env: envForClaudeChat(),
    cwd: DATA_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const startedAt = Date.now();
  let heartbeatTimer = null;
  let streamEnded = false;
  let assistantBuf = '';
  let assistantSaved = false;

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function appendAssistantToSession(content, errFlag) {
    if (assistantSaved) return;
    assistantSaved = true;
    const fresh = readChatSession(conversationId);
    if (!fresh) return;
    const msg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: content || '',
      createdAt: new Date().toISOString(),
    };
    if (errFlag) msg.error = true;
    fresh.messages.push(msg);
    fresh.updatedAt = msg.createdAt;
    try {
      atomicWriteChatSession(chatSessionPath(conversationId), fresh);
    } catch (e) {
      console.warn('[chat] could not save assistant message', e.message);
    }
  }

  function endSSE() {
    if (streamEnded) return;
    streamEnded = true;
    clearHeartbeat();
    try {
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch (_) {}
  }

  try {
    res.write(`data: ${JSON.stringify({ status: 'started' })}\n\n`);
  } catch (_) {}

  heartbeatTimer = setInterval(() => {
    if (streamEnded) return;
    try {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      res.write(`data: ${JSON.stringify({ heartbeat: true, elapsedSec })}\n\n`);
    } catch (_) {
      clearHeartbeat();
    }
  }, CHAT_HEARTBEAT_MS);

  proc.stdin.write(fullPrompt);
  proc.stdin.end();

  proc.on('error', (err) => {
    const errText = `Failed to start claude: ${err.message}. Set CLAUDE_BIN env var to the full path.`;
    try {
      res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
    } catch (_) {}
    appendAssistantToSession(`[Error] ${errText}`, true);
    endSSE();
  });

  proc.stdout.on('data', chunk => {
    const t = chunk.toString();
    assistantBuf += t;
    try {
      res.write(`data: ${JSON.stringify({ text: t })}\n\n`);
    } catch (_) {}
  });

  proc.stderr.on('data', chunk => {
    try {
      res.write(`data: ${JSON.stringify({ error: chunk.toString() })}\n\n`);
    } catch (_) {}
  });

  proc.on('close', (code) => {
    if (!assistantSaved) {
      let content = assistantBuf;
      if (!String(content).trim() && code !== 0 && code !== null) {
        content = `[Process exited with code ${code}]`;
      }
      const errFlag = code !== 0 && code !== null && !String(assistantBuf).trim();
      appendAssistantToSession(content, errFlag);
    }
    endSSE();
  });

  res.on('close', () => {
    clearHeartbeat();
    if (proc.exitCode === null && !proc.killed) {
      try { proc.kill(); } catch (_) {}
    }
  });
});

// ─── POST /api/upload — save files to team-inbox ─────────────────────────────
app.post('/api/upload', upload.array('files'), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
  const teamInboxPath = path.join(DATA_DIR, 'team-inbox');
  const body = req.body || {};
  const getHeader = (name) => req.get(name);
  const map = readFilesMetaMap(teamInboxPath);
  for (const f of req.files) {
    const key = f.filename;
    if (!safeBrowseFileName(key)) continue;
    const built = buildTeamInboxUploadMeta(key, body, getHeader);
    const prev = metaFieldsForFile(map, key);
    const merged = { ...prev, ...built };
    const next = {};
    if (merged.createdBy) next.createdBy = merged.createdBy;
    if (merged.domain) next.domain = merged.domain;
    if (merged.category) next.category = merged.category;
    map[key] = next;
  }
  writeFilesMetaMap(teamInboxPath, map);
  res.json({ uploaded: req.files.map(f => ({ name: f.originalname, size: f.size })) });
});

// ─── GET /api/files — list browsable directories ─────────────────────────────
const BROWSABLE = ['owners-inbox', 'team-inbox', 'team', 'docs'];
const EDITABLE_EXTS = ['.md', '.html', '.txt', '.json'];

function resolveBrowseLocation(dir, name) {
  const base = safeBrowseFileName(name);
  if (!base) return null;
  if (dir === 'root') {
    const brief = resolveOrchestratorBriefPath();
    if (!brief) return null;
    const onDisk = path.basename(brief);
    if (base !== onDisk && base !== ORCH_BRIEF_FILE && base !== ORCH_BRIEF_LEGACY) return null;
    return { dirPath: path.dirname(brief), fileName: onDisk, fullPath: brief };
  }
  if (!BROWSABLE.includes(dir)) return null;
  const dirPath = path.join(DATA_DIR, dir);
  const fullPath = path.join(dirPath, base);
  return { dirPath, fileName: base, fullPath };
}

function listVisibleFilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => !name.startsWith('.') && !name.startsWith('_archived_'))
    .map((name) => {
      const stat = fs.statSync(path.join(dirPath, name));
      if (!stat.isFile()) return null;
      return { name, size: stat.size, modified: stat.mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.modified - a.modified);
}

app.get('/api/files', (req, res) => {
  const result = {};
  for (const dir of BROWSABLE) {
    const dirPath = path.join(DATA_DIR, dir);
    const listed = listVisibleFilesInDir(dirPath);
    result[dir] = FILES_META_DIRS.has(dir) ? attachMetaToEntries(dirPath, listed) : entriesWithoutMeta(listed);
  }
  const briefPath = resolveOrchestratorBriefPath();
  if (briefPath) {
    const stat = fs.statSync(briefPath);
    const rootName = path.basename(briefPath);
    result['root'] = entriesWithoutMeta([{ name: rootName, size: stat.size, modified: stat.mtime }]);
  }
  res.json(result);
});

// ─── PATCH /api/files/:dir/:name/meta — createdBy, domain, category ───────────
app.patch('/api/files/:dir/:name/meta', (req, res) => {
  if (!FILES_META_DIRS.has(req.params.dir))
    return res.status(403).json({ error: 'Metadata is only available for docs, owners-inbox, and team-inbox' });
  const loc = resolveBrowseLocation(req.params.dir, req.params.name);
  if (!loc) return res.status(400).json({ error: 'Invalid path' });
  try {
    if (!fs.existsSync(loc.fullPath) || !fs.statSync(loc.fullPath).isFile())
      return res.status(404).json({ error: 'Not found' });
  } catch (_) {
    return res.status(404).json({ error: 'Not found' });
  }
  const body = req.body || {};
  const map = readFilesMetaMap(loc.dirPath);
  const cur = { ...metaFieldsForFile(map, loc.fileName) };
  if ('createdBy' in body) cur.createdBy = sanitizeMetaString(body.createdBy);
  if ('domain' in body) cur.domain = sanitizeMetaString(body.domain);
  if ('category' in body) cur.category = sanitizeMetaString(body.category);
  const next = {};
  if (cur.createdBy) next.createdBy = cur.createdBy;
  if (cur.domain) next.domain = cur.domain;
  if (cur.category) next.category = cur.category;
  if (Object.keys(next).length) map[loc.fileName] = next;
  else delete map[loc.fileName];
  writeFilesMetaMap(loc.dirPath, map);
  res.json({ ok: true, meta: metaFieldsForFile(map, loc.fileName) });
});

// ─── POST /api/files/:dir/:name/archive — rename to _archived_<name> ──────────
app.post('/api/files/:dir/:name/archive', (req, res) => {
  if (!FILES_META_DIRS.has(req.params.dir))
    return res.status(403).json({ error: 'Archive is only available for docs, owners-inbox, and team-inbox' });
  const loc = resolveBrowseLocation(req.params.dir, req.params.name);
  if (!loc) return res.status(400).json({ error: 'Invalid path' });
  const { name } = req.params;
  if (name.startsWith('_archived_'))
    return res.status(400).json({ error: 'Already archived' });
  try {
    if (!fs.existsSync(loc.fullPath) || !fs.statSync(loc.fullPath).isFile())
      return res.status(404).json({ error: 'Not found' });
  } catch (_) {
    return res.status(404).json({ error: 'Not found' });
  }
  const newName = `_archived_${name}`;
  const newPath = path.join(loc.dirPath, newName);
  if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Archive name already exists' });
  fs.renameSync(loc.fullPath, newPath);
  const map = readFilesMetaMap(loc.dirPath);
  if (map[name]) {
    map[newName] = map[name];
    delete map[name];
  }
  writeFilesMetaMap(loc.dirPath, map);
  res.json({ ok: true, archivedAs: newName });
});

// ─── GET /api/files/:dir/:name — read/download a file ────────────────────────
app.get('/api/files/:dir/:name', (req, res) => {
  const { dir, name } = req.params;
  if (!BROWSABLE.includes(dir)) return res.status(403).end();
  const filePath = path.join(DATA_DIR, dir, name);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  try {
    if (!fs.statSync(filePath).isFile()) return res.status(404).end();
  } catch (_) {
    return res.status(404).end();
  }
  res.sendFile(filePath);
});

// ─── PUT /api/files/:dir/:name — edit a text file ────────────────────────────
app.put('/api/files/:dir/:name', express.text({ type: '*/*', limit: '2mb' }), (req, res) => {
  const { dir, name } = req.params;
  if (!BROWSABLE.includes(dir)) return res.status(403).end();
  if (!EDITABLE_EXTS.includes(path.extname(name)))
    return res.status(403).json({ error: 'File type not editable' });
  const putPath = path.join(DATA_DIR, dir, name);
  try {
    if (fs.existsSync(putPath) && !fs.statSync(putPath).isFile())
      return res.status(403).json({ error: 'Not a file' });
  } catch (_) {}
  fs.writeFileSync(putPath, req.body, 'utf8');
  res.json({ ok: true });
});

// ─── GET/PUT /api/cyrus — orchestrator brief (CYRUS.md) ─────────────────────
function getOrchestratorBrief(req, res) {
  const p = resolveOrchestratorBriefPath();
  if (!p) return res.status(404).end();
  res.sendFile(p);
}
function putOrchestratorBrief(req, res) {
  fs.writeFileSync(orchestratorBriefWritePath(), req.body, 'utf8');
  res.json({ ok: true });
}
app.get('/api/cyrus', getOrchestratorBrief);
app.put('/api/cyrus', express.text({ type: '*/*', limit: '2mb' }), putOrchestratorBrief);
// Legacy alias (same file)
app.get('/api/larry', getOrchestratorBrief);
app.put('/api/larry', express.text({ type: '*/*', limit: '2mb' }), putOrchestratorBrief);

// ─── GET /api/dashboard ───────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const actionItems = q(brain, `
    SELECT id, domain, urgency, title, description, details, due_date, source_agent
    FROM action_items
    WHERE status = 'open'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

  const domainSummary = q(brain, `SELECT * FROM v_items_by_domain`);

  const activeWeek = q1(launchpad, `SELECT * FROM weeks WHERE status = 'active' LIMIT 1`);
  const weekGoals = activeWeek
    ? q(launchpad, `SELECT * FROM weekly_goals WHERE week_number = ? ORDER BY id`, [activeWeek.week_number])
    : [];

  res.json({ actionItems, domainSummary, activeWeek, weekGoals });
});

// ─── GET /api/career ──────────────────────────────────────────────────────────
app.get('/api/career', (req, res) => {
  const actionItems = q(brain, `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category, project_week
    FROM action_items
    WHERE status = 'open' AND domain = 'career'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

  const pipeline = q(launchpad, `SELECT * FROM v_pipeline`);

  const activeApplications = q(launchpad, `
    SELECT a.id, c.name AS company_name, a.role_title, a.role_type, a.status,
           a.next_step, a.next_step_date, a.salary_range, a.applied_date, a.referral_from
    FROM applications a
    JOIN companies c ON a.company_id = c.id
    WHERE a.status NOT IN ('rejected', 'withdrawn', 'ghosted', 'accepted')
    ORDER BY
      CASE a.status
        WHEN 'offer'          THEN 1
        WHEN 'interview_final'THEN 2
        WHEN 'interview_2'    THEN 3
        WHEN 'interview_1'    THEN 4
        WHEN 'phone_screen'   THEN 5
        WHEN 'responded'      THEN 6
        WHEN 'applied'        THEN 7
        ELSE 8
      END, a.next_step_date ASC NULLS LAST
  `);

  const activeWeek = q1(launchpad, `SELECT * FROM weeks WHERE status = 'active' LIMIT 1`);
  const weekGoals = activeWeek
    ? q(launchpad, `SELECT * FROM weekly_goals WHERE week_number = ? ORDER BY id`, [activeWeek.week_number])
    : [];

  const outreach = q(launchpad, `SELECT * FROM v_outreach_status ORDER BY next_action_date ASC NULLS LAST LIMIT 20`);

  const consultingLeads = q(launchpad, `
    SELECT cl.id, cl.company, cl.service_type, cl.estimated_value, cl.hourly_rate,
           cl.status, cl.closed_date, ct.name AS contact_name
    FROM consulting_leads cl
    LEFT JOIN contacts ct ON cl.contact_id = ct.id
    WHERE cl.status NOT IN ('won', 'lost')
    ORDER BY
      CASE cl.status
        WHEN 'negotiating'    THEN 1
        WHEN 'proposal_sent'  THEN 2
        WHEN 'conversation'   THEN 3
        ELSE 4
      END
  `);

  const consultingPipeline = q(launchpad, `SELECT * FROM v_consulting_pipeline`);

  res.json({ actionItems, pipeline, activeApplications, activeWeek, weekGoals, outreach, consultingLeads, consultingPipeline });
});

// ─── GET /api/finance ─────────────────────────────────────────────────────────
app.get('/api/finance', (req, res) => {
  const actionItems = q(brain, `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category
    FROM action_items
    WHERE status = 'open' AND domain = 'finance'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

  const burnRate = q(finance, `SELECT * FROM v_burn_rate_monthly ORDER BY month DESC LIMIT 3`);

  const categorySpend = q(finance, `
    SELECT * FROM v_monthly_by_category
    WHERE month = (SELECT MAX(month) FROM v_monthly_by_category)
    ORDER BY total_spent DESC
  `);

  const income = q(finance, `SELECT * FROM v_income_monthly ORDER BY month DESC LIMIT 6`);

  const topMerchants = q(finance, `SELECT * FROM v_top_merchants LIMIT 10`);

  const accountSnapshots = q(finance, `
    SELECT a.name, a.account_type, a.owner, a.institution,
           s.balance, s.available_credit, s.snapshot_date
    FROM account_snapshots s
    JOIN accounts a ON s.account_id = a.id
    WHERE s.id IN (
      SELECT MAX(id) FROM account_snapshots GROUP BY account_id
    )
    ORDER BY a.owner, a.account_type
  `);

  const complianceUpcoming = q(wynnset, `SELECT * FROM v_compliance_upcoming ORDER BY due_date`);

  const trialBalanceSummary = q(wynnset, `
    SELECT type,
      ROUND(SUM(total_debits), 2) AS debits,
      ROUND(SUM(total_credits), 2) AS credits,
      ROUND(SUM(net), 2) AS net
    FROM v_trial_balance
    GROUP BY type
    ORDER BY CASE type
      WHEN 'asset'     THEN 1
      WHEN 'liability' THEN 2
      WHEN 'equity'    THEN 3
      WHEN 'revenue'   THEN 4
      WHEN 'expense'   THEN 5
    END
  `);

  const shareholderLoan = q1(wynnset, `SELECT * FROM v_shareholder_loan_balance`);

  const shareholderLoanTxns = q(wynnset, `
    SELECT txn_date, description, amount, direction, running_balance, txn_type
    FROM shareholder_loan ORDER BY id DESC LIMIT 5
  `);

  res.json({
    actionItems, burnRate, categorySpend, income, topMerchants,
    accountSnapshots, complianceUpcoming, trialBalanceSummary,
    shareholderLoan, shareholderLoanTxns
  });
});

// ─── GET /api/business ────────────────────────────────────────────────────────
app.get('/api/business', (req, res) => {
  const actionItems = q(brain, `
    SELECT id, urgency, title, description, details, due_date, effort_hours, project_category
    FROM action_items
    WHERE status = 'open' AND domain = 'business'
      AND (snoozed_until IS NULL OR snoozed_until <= date('now'))
    ORDER BY
      CASE urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      due_date ASC NULLS LAST
  `);

  const complianceCalendar = q(wynnset, `
    SELECT id, event_type, description, due_date, fiscal_period, status,
           completed_date, completed_by, notes
    FROM compliance_events
    ORDER BY
      CASE status WHEN 'upcoming' THEN 1 WHEN 'overdue' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
      due_date ASC
  `);

  const complianceSummary = q(wynnset, `
    SELECT status, COUNT(*) AS count FROM compliance_events GROUP BY status
  `);

  const ledgerSummary = q1(wynnset, `
    SELECT COUNT(*) AS total_entries,
           MIN(entry_date) AS first_entry,
           MAX(entry_date) AS last_entry
    FROM journal_entries
  `);

  const coaSummary = q(wynnset, `
    SELECT type, COUNT(*) AS account_count
    FROM accounts_coa WHERE is_active = 1
    GROUP BY type
    ORDER BY CASE type
      WHEN 'asset'     THEN 1
      WHEN 'liability' THEN 2
      WHEN 'equity'    THEN 3
      WHEN 'revenue'   THEN 4
      WHEN 'expense'   THEN 5
    END
  `);

  const coaAccounts = q(wynnset, `
    SELECT code, name, type, subtype, description
    FROM accounts_coa WHERE is_active = 1 ORDER BY code
  `);

  const shareholderLoan = q1(wynnset, `SELECT * FROM v_shareholder_loan_balance`);

  res.json({ actionItems, complianceCalendar, complianceSummary, ledgerSummary, coaSummary, coaAccounts, shareholderLoan });
});

const ACTION_DOMAIN = new Set(['career', 'finance', 'business', 'personal', 'family']);
const ACTION_URGENCY = new Set(['critical', 'high', 'medium', 'low']);
const ACTION_STATUS = new Set(['open', 'done', 'dismissed']);

// ─── PATCH /api/action-items/:id — dashboard (session) updates action_items ───
app.patch('/api/action-items/:id', (req, res) => {
  const brainPath = path.join(DB_DIR, 'brain.db');
  if (!fs.existsSync(brainPath)) {
    return res.status(503).json({ error: 'brain.db not available' });
  }
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid action item id' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const sets = [];
  const params = [];

  if (body.title !== undefined) {
    const t = String(body.title || '').trim();
    if (!t) return res.status(400).json({ error: 'title cannot be empty' });
    sets.push('title = ?');
    params.push(t);
  }
  if (body.description !== undefined) {
    const v = body.description === null || body.description === '' ? null : String(body.description);
    sets.push('description = ?');
    params.push(v);
  }
  if (body.details !== undefined) {
    const v = body.details === null || body.details === '' ? null : String(body.details);
    sets.push('details = ?');
    params.push(v);
  }
  if (body.due_date !== undefined) {
    if (body.due_date === null || body.due_date === '') {
      sets.push('due_date = NULL');
    } else {
      sets.push('due_date = ?');
      params.push(String(body.due_date).trim().slice(0, 32));
    }
  }
  if (body.urgency !== undefined) {
    const u = String(body.urgency);
    if (!ACTION_URGENCY.has(u)) return res.status(400).json({ error: 'invalid urgency' });
    sets.push('urgency = ?');
    params.push(u);
  }
  if (body.domain !== undefined) {
    const d = String(body.domain);
    if (!ACTION_DOMAIN.has(d)) return res.status(400).json({ error: 'invalid domain' });
    sets.push('domain = ?');
    params.push(d);
  }
  if (body.status !== undefined) {
    const s = String(body.status);
    if (!ACTION_STATUS.has(s)) return res.status(400).json({ error: 'invalid status' });
    sets.push('status = ?');
    params.push(s);
    if (s === 'done') {
      sets.push(`completed_at = CURRENT_TIMESTAMP`);
    } else {
      sets.push('completed_at = NULL');
    }
  }
  if (body.project_category !== undefined) {
    const v = body.project_category === null || body.project_category === '' ? null : String(body.project_category);
    sets.push('project_category = ?');
    params.push(v);
  }
  if (body.effort_hours !== undefined) {
    if (body.effort_hours === null || body.effort_hours === '') {
      sets.push('effort_hours = NULL');
    } else {
      const n = Number(body.effort_hours);
      if (Number.isNaN(n)) return res.status(400).json({ error: 'invalid effort_hours' });
      sets.push('effort_hours = ?');
      params.push(n);
    }
  }
  if (body.project_week !== undefined) {
    if (body.project_week === null || body.project_week === '') {
      sets.push('project_week = NULL');
    } else {
      const n = parseInt(body.project_week, 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid project_week' });
      sets.push('project_week = ?');
      params.push(n);
    }
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No updatable fields' });
  }

  let rw;
  try {
    rw = new Database(brainPath);
    const row = rw.prepare('SELECT id FROM action_items WHERE id = ?').get(id);
    if (!row) {
      rw.close();
      return res.status(404).json({ error: 'Action item not found' });
    }
    const sql = `UPDATE action_items SET ${sets.join(', ')} WHERE id = ?`;
    params.push(id);
    rw.prepare(sql).run(...params);
    rw.close();
    rw = null;
  } catch (err) {
    console.error('PATCH /api/action-items:', err.message);
    if (rw) try { rw.close(); } catch (_) {}
    return res.status(500).json({ error: err.message || 'Update failed' });
  }
  return res.json({ ok: true });
});

// ─── Static (dashboard + assets) — after auth gate ───────────────────────────
app.use(express.static(__dirname, { index: 'dashboard.html' }));

// ─── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  console.log(`Cyrus dashboard running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  try {
    const { default: open } = await import('open');
    await open(`http://localhost:${PORT}`);
  } catch (_) {}
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=${PORT + 1} node server.js`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
