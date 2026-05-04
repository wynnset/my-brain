'use strict';

const { ORCH_BRIEF_FILE, ORCH_BRIEF_LEGACY } = require('../lib/orchestrator-brief.js');
const {
  appendOrchestratorOperatingRules,
  appendPlatformConfidentialityRules,
  readPlatformConfidentialityRules,
  readSubagentOperatingRules,
} = require('../chat/operating-rules.js');
const {
  loadTenantAgentDefinitions,
  parseGlobalToolAllowEnv,
  attachBrainFetchMcpToTeamAgents,
} = require('../chat/team-agents.js');
const chatMemory = require('../chat/chat-memory.js');
const { createChatRunRegistry, RunAlreadyActiveError } = require('../chat/chat-run-registry.js');

/** @param {import("express").Application} app @param {Record<string, unknown>} ctx */
module.exports = function registerChatRoutes(app, ctx) {
  const {
    path,
    fs,
    crypto,
    pathToFileURL,
    Database,
    tenancy,
    registryDb,
    tenantDataDirForRequest,
    workspaceDirForRequest,
    getRegistryReadonly,
    withRegistryReadWrite,
    appendAssistantStreamChunk,
    orchestrator,
  } = ctx;
  const { assertUnderRoot, safeJoin } = tenancy;
  const {
    resolveOrchestratorBriefPathInWorkspace,
    isOrchestratorChatAgent,
  } = orchestrator;

  // ─── Chat sessions (JSON files under tenant dataDir/chat-sessions) ─────────────
  const CHAT_LIST_LIMIT = 200;
  /** SSE keepalive while the model runs; UI copy rotates on its own — this only needs to beat proxy timeouts. */
  const CHAT_HEARTBEAT_MS = Number(process.env.BRAIN_CHAT_HEARTBEAT_MS) || 5000;
  /** Throttle for writing in-progress assistant text to the session JSON (registry / multi-tab path). */
  const CHAT_PARTIAL_FLUSH_MS = Number(process.env.BRAIN_CHAT_PARTIAL_FLUSH_MS) || 750;
  const CHAT_MAX_TRANSCRIPT_CHARS = Number(process.env.BRAIN_CHAT_MAX_TRANSCRIPT_CHARS) || 100000;
  const CHAT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  /** When truthy (default), chat runs use the in-process registry (multi-tab / reattach). Set BRAIN_CHAT_REGISTRY=0 to restore legacy single-stream POST behavior. */
  const USE_CHAT_RUN_REGISTRY = String(process.env.BRAIN_CHAT_REGISTRY || '1').trim() !== '0';

  const chatRunRegistry = createChatRunRegistry({ heartbeatMs: CHAT_HEARTBEAT_MS });

  /** Opaque tenant scope for chat run registry (must match between POST /api/chat and GET stream). */
  function tenantKeyForChatRun(req) {
    if (req.tenant && req.tenant.userId != null) {
      return `u:${String(req.tenant.userId)}`;
    }
    return `d:${path.resolve(tenantDataDirForRequest(req))}`;
  }

  /**
   * Dashboard model picker: ids must match what Claude Code / Agent SDK accept (alias or full id).
   * Pricing is approximate (API list rates; actual bill varies by tier and batch).
   * @type {{ id: string, label: string, contextLabel: string, costHint: string }[]}
   */
  const CHAT_MODEL_CATALOG = [
    {
      id: 'sonnet',
      label: 'Sonnet',
      contextLabel: '200k',
      costHint: '≈ $3 / $15 per M tok (in / out)',
    },
    {
      id: 'opus',
      label: 'Opus',
      contextLabel: '200k',
      costHint: '≈ $5 / $25 per M tok (in / out)',
    },
    {
      id: 'haiku',
      label: 'Haiku',
      contextLabel: '200k',
      costHint: '≈ $1 / $5 per M tok (in / out)',
    },
  ];
  const CHAT_MODEL_IDS = new Set(CHAT_MODEL_CATALOG.map((m) => m.id));

  function getDefaultChatModelId() {
    const raw = String(process.env.BRAIN_CHAT_DEFAULT_MODEL || '').trim();
    if (raw && CHAT_MODEL_IDS.has(raw)) return raw;
    return CHAT_MODEL_IDS.has('haiku') ? 'haiku' : CHAT_MODEL_CATALOG[0] ? CHAT_MODEL_CATALOG[0].id : 'sonnet';
  }

  /** @param {string} id */
  function isAllowedChatModelId(id) {
    return CHAT_MODEL_IDS.has(String(id || '').trim().toLowerCase());
  }

  /**
   * @param {object} sess
   * @param {unknown} bodyModel
   * @param {number} userMsgsBefore
   * @returns {{ ok: true, model: string } | { ok: false, error: string }}
   */
  function resolveChatModelForRequest(sess, bodyModel, userMsgsBefore) {
    const incoming =
      bodyModel != null && String(bodyModel).trim() !== ''
        ? String(bodyModel).trim().toLowerCase()
        : '';
    const rawStored = sess.model != null && String(sess.model).trim() !== '' ? String(sess.model).trim().toLowerCase() : '';
    const stored = rawStored && isAllowedChatModelId(rawStored) ? rawStored : '';

    if (userMsgsBefore > 0) {
      if (incoming && !isAllowedChatModelId(incoming)) {
        return { ok: false, error: 'Invalid model' };
      }
      const model = incoming || stored || getDefaultChatModelId();
      return { ok: true, model };
    }

    const pick = incoming || stored || getDefaultChatModelId();
    if (!isAllowedChatModelId(pick)) return { ok: false, error: 'Invalid model' };
    return { ok: true, model: pick };
  }

  /** Last assistant message with a recorded catalog model (newest first). */
  function inferRecordedModelFromMessages(messages) {
    if (!Array.isArray(messages)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m || m.role !== 'assistant') continue;
      const mid = m.model != null ? String(m.model).trim().toLowerCase() : '';
      if (mid && isAllowedChatModelId(mid)) return mid;
    }
    return null;
  }

  /** Model recorded for this session (root field, else inferred from messages). */
  function recordedModelForSession(sess) {
    if (!sess || typeof sess !== 'object') return null;
    const top = sess.model != null ? String(sess.model).trim().toLowerCase() : '';
    if (top && isAllowedChatModelId(top)) return top;
    return inferRecordedModelFromMessages(sess.messages);
  }

  function applyRecordedModelToSessionObject(o) {
    if (!o || typeof o !== 'object') return;
    const r = recordedModelForSession(o);
    if (r) {
      o.model = r;
      return;
    }
    const raw = o.model != null ? String(o.model).trim() : '';
    if (raw && !isAllowedChatModelId(raw.toLowerCase())) delete o.model;
  }

  function chatSessionsDirForRequest(req) {
    return path.join(tenantDataDirForRequest(req), 'chat-sessions');
  }
  
  function ensureChatSessionsDir(req) {
    try {
      fs.mkdirSync(chatSessionsDirForRequest(req), { recursive: true });
    } catch (err) {
      console.warn('[chat-sessions] mkdir', err.message);
    }
  }
  
  function chatSessionPath(req, id) {
    if (!CHAT_ID_RE.test(String(id || ''))) return null;
    const base = chatSessionsDirForRequest(req);
    const full = path.join(base, `${id}.json`);
    try {
      assertUnderRoot(full, tenantDataDirForRequest(req));
    } catch (_) {
      return null;
    }
    return full;
  }
  
  function atomicWriteChatSession(filePath, obj) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, filePath);
  }
  
  function readChatSession(req, id) {
    const p = chatSessionPath(req, id);
    if (!p || !fs.existsSync(p)) return null;
    try {
      const o = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!o || typeof o !== 'object' || !Array.isArray(o.messages)) return null;
      if (!o.id) o.id = id;
      applyRecordedModelToSessionObject(o);
      return o;
    } catch (_) {
      return null;
    }
  }

  /**
   * Best-effort markdown-mirror of a chat session under
   * `<workspaceDir>/memory/chats/<id>.md`. Never throws — a mirror failure
   * must not take down the live chat. See `chat-memory.js` for the format
   * and rationale.
   *
   * @param {import('express').Request} req
   * @param {Record<string, unknown>} sess
   */
  function mirrorChatSessionSafely(req, sess) {
    if (chatMemory.isFeatureDisabled()) return;
    try {
      const ws = workspaceDirForRequest(req);
      chatMemory.writeChatSessionMemoryMirror(ws, sess);
    } catch (err) {
      console.warn('[chat-memory] mirror write failed:', err && err.message ? err.message : err);
    }
  }

  /**
   * Canonical write path for chat sessions: persist the JSON atomically, then
   * update the workspace-visible markdown mirror so the agent can Grep prior
   * turns on the next request. Callers keep their existing try/catch around
   * this call — the JSON write is what may fail; the mirror is best-effort.
   *
   * @param {import('express').Request} req
   * @param {string} conversationId
   * @param {Record<string, unknown>} sess
   */
  function persistChatSession(req, conversationId, sess) {
    const p = chatSessionPath(req, conversationId);
    if (!p) throw new Error('Invalid conversation id');
    atomicWriteChatSession(p, sess);
    mirrorChatSessionSafely(req, sess);
  }

  /**
   * Lazy per-tenant backfill: walk the chat-sessions dir once per tenant on
   * first chat use and write any missing mirrors. Guarded by a marker file
   * so subsequent requests short-circuit. Safe to call on every POST.
   *
   * @param {import('express').Request} req
   */
  function ensureChatMemoryBackfilled(req) {
    if (chatMemory.isFeatureDisabled()) return;
    try {
      const ws = workspaceDirForRequest(req);
      const dir = chatSessionsDirForRequest(req);
      chatMemory.backfillChatSessionMemoryMirrors({
        chatSessionsDir: dir,
        workspaceDir: ws,
        readOneSession: (id) => readChatSession(req, id),
      });
    } catch (err) {
      console.warn('[chat-memory] backfill failed:', err && err.message ? err.message : err);
    }
  }

  /** Same top-level dirs as Files in the dashboard (+ workspace-root orchestrator brief). */
  const CHAT_WORKSPACE_TOUCH_LIMIT = 200;
  const FILES_TAB_PREFIXES = new Set(['owners-inbox', 'team-inbox', 'team', 'docs']);

  function lastMessageCreatedIso(messages) {
    if (!Array.isArray(messages) || !messages.length) return null;
    const last = messages[messages.length - 1];
    const iso = last && last.createdAt != null ? String(last.createdAt).trim() : '';
    return iso || null;
  }

  function normalizeWorkspaceTouches(arr) {
    const map = new Map();
    for (const raw of Array.isArray(arr) ? arr : []) {
      if (!raw || typeof raw !== 'object') continue;
      let rel = String(raw.path || '')
        .trim()
        .replace(/\\/g, '/');
      if (!rel) continue;
      rel = rel.replace(/^\/+/, '');
      const k = raw.kind === 'edited' ? 'edited' : raw.kind === 'added' ? 'added' : null;
      if (!k) continue;
      const at = String(raw.at || '').trim() || new Date().toISOString();
      const prev = map.get(rel);
      if (!prev || at >= prev.at) map.set(rel, { path: rel, kind: k, at });
    }
    let list = Array.from(map.values());
    list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    if (list.length > CHAT_WORKSPACE_TOUCH_LIMIT) list = list.slice(0, CHAT_WORKSPACE_TOUCH_LIMIT);
    list.sort((a, b) => a.path.localeCompare(b.path));
    return list;
  }

  function filterTouchesThroughLastMessage(workspaceTouches, messages) {
    const iso = lastMessageCreatedIso(messages);
    if (!iso) return [];
    const raw = Array.isArray(workspaceTouches) ? workspaceTouches : [];
    return normalizeWorkspaceTouches(raw.filter((t) => t && t.at && String(t.at) <= iso));
  }

  function toWorkspaceRelativePosix(ws, rawPath) {
    const raw = String(rawPath || '').trim();
    if (!raw) return null;
    const wsAbs = path.resolve(ws);
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(wsAbs, raw);
    const norm = path.normalize(abs);
    const rel = path.relative(wsAbs, norm);
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join('/');
  }

  function isTrackedWorkspaceRel(relPosix) {
    if (!relPosix) return false;
    const seg = relPosix.split('/').filter(Boolean);
    if (!seg.length) return false;
    if (FILES_TAB_PREFIXES.has(seg[0])) return true;
    if (seg.length === 1 && (seg[0] === ORCH_BRIEF_FILE || seg[0] === ORCH_BRIEF_LEGACY)) return true;
    return false;
  }

  function touchKindForSdkTool(toolName) {
    const n = String(toolName || '')
      .trim()
      .toLowerCase();
    if (!n) return null;
    if (n === 'write' || n === 'create') return 'added';
    if (n === 'edit' || n === 'multiedit' || n.includes('str_replace') || n === 'notebookedit' || n.includes('patch'))
      return 'edited';
    return null;
  }

  function collectFilePathsFromToolInput(toolInput) {
    const ti = toolInput && typeof toolInput === 'object' ? toolInput : null;
    if (!ti) return [];
    const out = [];
    const push = (p) => {
      const s = typeof p === 'string' ? p.trim() : '';
      if (s) out.push(s);
    };
    push(ti.file_path);
    push(ti.path);
    push(ti.target_file);
    push(ti.filePath);
    push(ti.file);
    if (Array.isArray(ti.file_paths)) for (const p of ti.file_paths) push(p);
    if (Array.isArray(ti.paths)) for (const p of ti.paths) push(p);
    if (Array.isArray(ti.edits)) {
      for (const ed of ti.edits) {
        if (ed && typeof ed === 'object') push(ed.file_path || ed.path);
      }
    }
    return [...new Set(out)];
  }

  function appendSdkPostToolTouchesToPending(ws, pending, toolName, toolInput) {
    const kind = touchKindForSdkTool(toolName);
    if (!kind) return;
    for (const fp of collectFilePathsFromToolInput(toolInput)) {
      const rel = toWorkspaceRelativePosix(ws, fp);
      if (!rel || !isTrackedWorkspaceRel(rel)) continue;
      pending.push({ path: rel, kind });
    }
  }

  function mergePendingWorkspaceTouchesIntoSession(req, conversationId, pendingPairs) {
    if (!pendingPairs || !pendingPairs.length) return;
    const p = chatSessionPath(req, conversationId);
    if (!p) return;
    const fresh = readChatSession(req, conversationId);
    if (!fresh) return;
    const now = new Date().toISOString();
    const base = normalizeWorkspaceTouches(fresh.workspaceTouches);
    const merged = normalizeWorkspaceTouches([
      ...base,
      ...pendingPairs.map((x) => ({ path: x.path, kind: x.kind, at: now })),
    ]);
    fresh.workspaceTouches = merged;
    try {
      persistChatSession(req, conversationId, fresh);
    } catch (e) {
      console.warn('[chat] workspaceTouches merge failed', e.message);
    }
  }
  
  /** Convention: optional markdown plan written by the agent (Claude Code–style). */
  const BRAIN_CHAT_PLAN_FILE_SEG = ['docs', 'brain-chat-plan.md'];
  const CHAT_PLAN_SESSION_MARKDOWN_MAX = 100000;
  
  const CHAT_PLAN_PHASE_SYSTEM_SUFFIX = `
  
  ---
  
  ## Dashboard plan mode (planning only)
  
  You are in **planning** mode: **do not** edit files, run shell commands, or apply patches. Use read-only tools if you need context.
  
  Respond with:
  1. A short natural-language summary of the approach.
  2. A single fenced code block labeled **brain_plan** whose body is **valid JSON only**: a JSON array of objects \`{ "id": string, "title": string, "status": "pending" }\` (one row per concrete step). Use stable \`id\` values like \`"1"\`, \`"2"\`.
  
  The dashboard **saves** the finished plan as markdown under \`owners-inbox/plan-<conversation-uuid>.md\` (Files → Owners Inbox). You do **not** need to write that file yourself in planning mode.
  
  Example closing block:
  
  \`\`\`brain_plan
  [{"id":"1","title":"Locate config loader","status":"pending"},{"id":"2","title":"Add validation","status":"pending"}]
  \`\`\`
  `;
  
  const CHAT_EXECUTE_PLAN_SYSTEM_SUFFIX = `
  
  ---
  
  ## Dashboard plan mode (execution)
  
  The user has approved a checklist (saved under \`owners-inbox/plan-<conversation-uuid>.md\` and mirrored in the session). **Execute** the steps in order using your tools. After each major step, briefly state what you did. Mark conceptual progress in your narration.
  `;
  
  const CHAT_PLAN_REVISION_CHAT_SUFFIX = `
  
  ---
  
  ## Pending checklist — user may be revising it
  
  A **plan checklist is awaiting approval** (also stored in Owners Inbox as markdown). The user’s latest message may correct or refine that plan (e.g. remove a tool you assumed, change a channel, narrow scope).
  
  **You must:** (1) Read their message and **directly address** each correction in plain language before moving on. (2) If the plan changes, reply with an **updated** ordered checklist as a single fenced block \`\`\`brain_plan … \`\`\` whose body is **valid JSON only**: the same schema as planning mode (\`{ "id", "title", "status" }\`). Do not ignore constraints they stated (e.g. “we don’t use Slack” → remove or replace Slack-specific steps).
  
  If their message does not require plan changes, acknowledge briefly and you may omit a new \`brain_plan\` block.
  `;
  
  function normalizeChatPlanPhase(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'plan') return 'plan';
    if (s === 'execute') return 'execute';
    return null;
  }
  
  function sanitizePlanTodoItems(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (let i = 0; i < arr.length && out.length < 50; i++) {
      const item = arr[i];
      if (typeof item === 'string') {
        const title = item.trim().slice(0, 500);
        if (title) out.push({ id: String(out.length + 1), title, status: 'pending' });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const id = item.id != null ? String(item.id).trim().slice(0, 64) : String(out.length + 1);
      const title = String(item.title || item.text || item.task || '')
        .trim()
        .slice(0, 500);
      if (!title) continue;
      let status = String(item.status || 'pending').toLowerCase();
      if (!['done', 'pending', 'in_progress'].includes(status)) status = 'pending';
      out.push({ id: id || String(out.length + 1), title, status });
    }
    return out;
  }
  
  /**
   * @param {string} text
   * @param {boolean} [strict] When true (e.g. user is revising a pending plan in Chat mode), only accept ```brain_plan``` — no loose JSON scan (avoids false positives).
   */
  function parseBrainPlanTodosFromAssistantText(text, strict) {
    const s = String(text || '');
    const fence = /```brain_plan\s*([\s\S]*?)```/i.exec(s);
    let raw = fence ? fence[1].trim() : '';
    let arr = null;
    if (raw) {
      try {
        arr = JSON.parse(raw);
      } catch (_) {
        arr = null;
      }
    }
    if (!Array.isArray(arr) && !strict) {
      const loose = s.match(/\[[\s\S]{0,80000}\]/);
      if (loose) {
        try {
          arr = JSON.parse(loose[0]);
        } catch (_) {
          arr = null;
        }
      }
    }
    return sanitizePlanTodoItems(arr || []);
  }
  
  function todosFromMarkdownFallback(md) {
    const lines = String(md || '').split('\n');
    const out = [];
    let n = 0;
    for (const line of lines) {
      const m = /^(\s*[-*]\s+|\s*\d+\.\s+)(.+)$/.exec(line);
      if (!m) continue;
      const title = m[2].replace(/^\[[ xX]\]\s*/, '').trim().slice(0, 500);
      if (!title || title.startsWith('#')) continue;
      n += 1;
      out.push({ id: `m${n}`, title, status: 'pending' });
      if (out.length >= 40) break;
    }
    return out;
  }
  
  function brainChatPlanFileFullPath(ws) {
    try {
      return safeJoin(ws, ...BRAIN_CHAT_PLAN_FILE_SEG);
    } catch (_) {
      return null;
    }
  }
  
  function readBrainChatPlanMarkdown(ws) {
    const full = brainChatPlanFileFullPath(ws);
    if (!full || !fs.existsSync(full)) return '';
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) return '';
      return fs.readFileSync(full, 'utf8').slice(0, CHAT_PLAN_SESSION_MARKDOWN_MAX);
    } catch (_) {
      return '';
    }
  }
  
  function stripBrainPlanFenceFromAssistant(text) {
    return String(text || '')
      .replace(/```brain_plan\s*[\s\S]*?```/gi, '')
      .trim();
  }
  
  function inboxChatPlanMarkdownFileName(conversationId) {
    const id = String(conversationId || '').replace(/[^0-9a-f-]/gi, '');
    return `plan-${id}.md`;
  }
  
  function atomicWriteUtf8WorkspaceFile(fullPath, utf8) {
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(fullPath);
    const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, utf8, 'utf8');
    fs.renameSync(tmp, fullPath);
  }
  
  /**
   * Persists a readable plan to owners-inbox (server-side; plan mode stays read-only for the agent).
   * @returns {null | { dir: 'owners-inbox', name: string, touchKind: 'added' | 'edited' }}
   */
  function writeChatPlanMarkdownToOwnersInbox(ws, conversationId, { planTodos, planMarkdown, assistantContent, sessionTitle }) {
    const todos = sanitizePlanTodoItems(planTodos || []);
    const extraMd = String(planMarkdown || '').trim();
    const notes = stripBrainPlanFenceFromAssistant(assistantContent);
    if (!todos.length && !extraMd && !notes) return null;
    const name = inboxChatPlanMarkdownFileName(conversationId);
    let fullPath;
    try {
      fullPath = safeJoin(ws, 'owners-inbox', name);
      assertUnderRoot(fullPath, ws);
    } catch (_) {
      return null;
    }
    let planFileExisted = false;
    try {
      planFileExisted = fs.existsSync(fullPath);
    } catch (_) {}
    const titleLine = String(sessionTitle || 'Plan')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^#+\s*/, '');
    const lines = [];
    lines.push(`# ${titleLine || 'Plan'}`);
    lines.push('');
    lines.push(`*Updated ${new Date().toISOString()} · conversation \`${conversationId}\`*`);
    lines.push('');
    if (todos.length) {
      lines.push('## Checklist');
      lines.push('');
      for (const t of todos) {
        const c = String(t.status || '').toLowerCase() === 'done' ? 'x' : ' ';
        lines.push(`- [${c}] ${String(t.title || '').replace(/\n/g, ' ')}`);
      }
      lines.push('');
    }
    if (notes) {
      lines.push('## Summary');
      lines.push('');
      lines.push(notes);
      lines.push('');
    }
    if (extraMd) {
      lines.push('## Detail');
      lines.push('');
      lines.push(extraMd.slice(0, CHAT_PLAN_SESSION_MARKDOWN_MAX));
      lines.push('');
    }
    const md = `${lines.join('\n').trim()}\n`;
    try {
      atomicWriteUtf8WorkspaceFile(fullPath, md);
    } catch (e) {
      console.warn('[chat-plan] owners-inbox write failed', e.message);
      return null;
    }
    return { dir: 'owners-inbox', name, touchKind: planFileExisted ? 'edited' : 'added' };
  }
  
  function persistChatPlanToSession(req, conversationId, { planTodos, planMarkdown, lastPhase, planInboxFile }) {
    const p = chatSessionPath(req, conversationId);
    if (!p) return;
    const fresh = readChatSession(req, conversationId);
    if (!fresh) return;
    if (Array.isArray(planTodos)) fresh.planTodos = planTodos;
    if (typeof planMarkdown === 'string') {
      fresh.planMarkdown = planMarkdown.slice(0, CHAT_PLAN_SESSION_MARKDOWN_MAX);
    }
    fresh.planUpdatedAt = new Date().toISOString();
    if (lastPhase) {
      fresh.planLastPhase = lastPhase;
      if (lastPhase === 'plan') {
        fresh.planExecutePending = Array.isArray(planTodos) && planTodos.length > 0;
        if (planInboxFile && planInboxFile.dir && planInboxFile.name) {
          fresh.planInboxFile = { dir: String(planInboxFile.dir), name: String(planInboxFile.name) };
        } else {
          delete fresh.planInboxFile;
        }
      }
      if (lastPhase === 'execute') {
        fresh.planExecutePending = false;
        fresh.planTodos = [];
        fresh.planMarkdown = '';
        delete fresh.planInboxFile;
      }
    }
    try {
      persistChatSession(req, conversationId, fresh);
    } catch (e) {
      console.warn('[chat-plan] could not persist plan fields', e.message);
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
  
  function lastUserContent(messages) {
    const arr = Array.isArray(messages) ? messages : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i];
      if (m && m.role === 'user') return String(m.content || '').trim();
    }
    return '';
  }
  
  function mergeAgentSdkSessionIntoSession(req, conversationId, sessionId) {
    if (!CHAT_ID_RE.test(String(conversationId || '')) || !sessionId) return;
    const p = chatSessionPath(req, conversationId);
    if (!p) return;
    const fresh = readChatSession(req, conversationId);
    if (!fresh) return;
    fresh.agentSdkSessionId = sessionId;
    fresh.updatedAt = new Date().toISOString();
    try {
      persistChatSession(req, conversationId, fresh);
    } catch (e) {
      console.warn('[chat-sdk] could not persist agentSdkSessionId', e.message);
    }
  }
  
  /**
   * Accumulate Agent SDK billing into `sess.sdkUsageSessionTotals` (mutates sess).
   * @param {Record<string, unknown>} sess
   * @param {{ totalCostUsd?: number | null, usage?: Record<string, number> | null, modelUsage?: Record<string, Record<string, number>> | null } | null | undefined} billing
   */
  function mergeSdkBillingIntoSessionTotals(sess, billing) {
    if (!sess || !billing) return;
    const hasCost = billing.totalCostUsd != null && Number.isFinite(billing.totalCostUsd);
    const hasUsage = billing.usage && typeof billing.usage === 'object';
    const hasModelUsage = billing.modelUsage && typeof billing.modelUsage === 'object';
    if (!hasCost && !hasUsage && !hasModelUsage) return;
  
    if (!sess.sdkUsageSessionTotals || typeof sess.sdkUsageSessionTotals !== 'object') {
      sess.sdkUsageSessionTotals = { totalCostUsd: 0, usage: {}, modelUsage: {} };
    }
    const totals = sess.sdkUsageSessionTotals;
    if (typeof totals.totalCostUsd !== 'number' || !Number.isFinite(totals.totalCostUsd)) totals.totalCostUsd = 0;
    if (!totals.usage || typeof totals.usage !== 'object') totals.usage = {};
    if (!totals.modelUsage || typeof totals.modelUsage !== 'object') totals.modelUsage = {};
  
    if (hasCost) totals.totalCostUsd += billing.totalCostUsd;
  
    if (hasUsage) {
      for (const [k, v] of Object.entries(billing.usage)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          totals.usage[k] = (typeof totals.usage[k] === 'number' ? totals.usage[k] : 0) + v;
        }
      }
    }
  
    if (hasModelUsage) {
      for (const [model, mu] of Object.entries(billing.modelUsage)) {
        if (!mu || typeof mu !== 'object') continue;
        const acc = totals.modelUsage[model] && typeof totals.modelUsage[model] === 'object' ? { ...totals.modelUsage[model] } : {};
        for (const [k, v] of Object.entries(mu)) {
          if (typeof v === 'number' && Number.isFinite(v)) {
            acc[k] = (typeof acc[k] === 'number' ? acc[k] : 0) + v;
          }
        }
        totals.modelUsage[model] = acc;
      }
    }
  }

  /** Deep-clone a stored message with a new id (forked conversations). */
  function cloneMessageForFork(m) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const out = {
      id,
      role: m.role,
      content: String(m.content || ''),
      createdAt: m.createdAt || now,
    };
    if (m.role === 'assistant') {
      const mid = m.model != null ? String(m.model).trim().toLowerCase() : '';
      if (mid && isAllowedChatModelId(mid)) out.model = mid;
      if (m.error === true) out.error = true;
      if (m.sdkBilling && typeof m.sdkBilling === 'object') {
        const sb = JSON.parse(JSON.stringify(m.sdkBilling));
        delete sb.userMessageId;
        const hasUsd = sb.totalCostUsd != null && Number.isFinite(sb.totalCostUsd);
        const hasUsage = sb.usage && typeof sb.usage === 'object' && Object.keys(sb.usage).length > 0;
        const hasModelUsage =
          sb.modelUsage && typeof sb.modelUsage === 'object' && Object.keys(sb.modelUsage).length > 0;
        const hasNumTurns = typeof sb.numTurns === 'number' && Number.isFinite(sb.numTurns);
        const hasSubtype = sb.resultSubtype != null && String(sb.resultSubtype).trim() !== '';
        if (hasUsd || hasUsage || hasModelUsage || hasNumTurns || hasSubtype) out.sdkBilling = sb;
      }
    }
    return out;
  }

  /** Rebuild session rollup totals from assistant messages' sdkBilling. */
  function sdkTotalsFromMessages(messages) {
    const sess = { sdkUsageSessionTotals: { totalCostUsd: 0, usage: {}, modelUsage: {} } };
    for (const m of messages || []) {
      if (m && m.role === 'assistant' && m.sdkBilling) mergeSdkBillingIntoSessionTotals(sess, m.sdkBilling);
    }
    const t = sess.sdkUsageSessionTotals;
    const hasCost = typeof t.totalCostUsd === 'number' && Number.isFinite(t.totalCostUsd) && t.totalCostUsd !== 0;
    const hasUsage = t.usage && typeof t.usage === 'object' && Object.keys(t.usage).length > 0;
    const hasModelUsage = t.modelUsage && typeof t.modelUsage === 'object' && Object.keys(t.modelUsage).length > 0;
    if (!hasCost && !hasUsage && !hasModelUsage) return null;
    return t;
  }

  /** Remove dashboard plan fields and Agent SDK resume id (truncate / fork mid-thread). */
  function stripForkBranchPlanAndResume(sess) {
    if (!sess || typeof sess !== 'object') return;
    sess.planExecutePending = false;
    delete sess.planTodos;
    delete sess.planMarkdown;
    delete sess.planLastPhase;
    delete sess.planInboxFile;
    delete sess.planUpdatedAt;
    delete sess.agentSdkSessionId;
  }

  /**
   * When the forked transcript ends at the same point as the source (last message), copy pending plan state.
   * @param {Record<string, unknown>} newSess
   * @param {Record<string, unknown>} source
   */
  function copyPendingPlanIfForkAtSessionTail(newSess, source) {
    if (!newSess || !source || source.planExecutePending !== true) {
      stripForkBranchPlanAndResume(newSess);
      return;
    }
    const todos = sanitizePlanTodoItems(source.planTodos || []);
    if (!todos.length) {
      stripForkBranchPlanAndResume(newSess);
      return;
    }
    newSess.planExecutePending = true;
    newSess.planTodos = todos;
    if (typeof source.planMarkdown === 'string' && source.planMarkdown) {
      newSess.planMarkdown = source.planMarkdown.slice(0, CHAT_PLAN_SESSION_MARKDOWN_MAX);
    }
    if (source.planLastPhase) newSess.planLastPhase = source.planLastPhase;
    if (source.planInboxFile && source.planInboxFile.dir && source.planInboxFile.name) {
      newSess.planInboxFile = {
        dir: String(source.planInboxFile.dir),
        name: String(source.planInboxFile.name),
      };
    }
    if (source.planUpdatedAt) newSess.planUpdatedAt = source.planUpdatedAt;
  }
  
  // ─── POST /api/chat — run the Claude Agent SDK against an agent prompt ────────
  /** SDK passes this to `pathToClaudeCodeExecutable`; falls back to sibling of `node`. */
  function resolveClaudeCodeExecutablePath() {
    const a = (process.env.CLAUDE_BIN || '').trim();
    const b = (process.env.CLAUDE_CODE_EXECUTABLE || '').trim();
    if (a || b) return a || b;
    const nodeDir = path.dirname(process.execPath);
    const candidates = [
      path.join(nodeDir, 'claude'),
      path.join(nodeDir, 'claude.cmd'),
    ];
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        if (process.platform === 'win32') return p;
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch (_) {}
    }
    return '';
  }

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
  
  /**
   * Rewrite the tenant's `workspace/config.json` so DB-path keys point at the
   * actual container paths under `dataDir` (the runtime tenant data dir).
   *
   * Background: tenant configs created from a local install (or copied during
   * the legacy-volume migration) often hold host-machine paths like
   * `/Users/<me>/.../data/finance.db`. Inside the Fly container those paths
   * don't exist; an agent that opens them via `sqlite3` gets a brand-new empty
   * database with no tables and concludes the schema is missing.
   *
   * Strategy: only touch the well-known *_db_path keys (and write a single
   * canonical `data_dir`). Custom keys, thresholds, currency, owner_name etc.
   * are preserved as-is. Writes are atomic and skipped when nothing changed.
   *
   * @param {string} workspaceDir Tenant workspace root (where `config.json` lives).
   * @param {string} dataDir      Tenant data dir (where `*.db` files live).
   */
  function normalizeWorkspaceConfigDbPaths(workspaceDir, dataDir) {
    if (!workspaceDir || !dataDir) return;
    const cfgPath = path.join(workspaceDir, 'config.json');
    let raw;
    try {
      raw = fs.readFileSync(cfgPath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[chat] config.json normalize: read failed:', err.message);
      }
      return;
    }
    let cfg;
    try {
      cfg = JSON.parse(raw);
    } catch (err) {
      console.warn('[chat] config.json normalize: parse failed:', err.message);
      return;
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return;
    const absData = path.resolve(dataDir);
    const want = {
      data_dir: absData,
      db_path: path.join(absData, 'finance.db'),
      brain_db_path: path.join(absData, 'brain.db'),
      wynnset_db_path: path.join(absData, 'wynnset.db'),
      launchpad_db_path: path.join(absData, 'launchpad.db'),
    };
    let changed = false;
    for (const [k, v] of Object.entries(want)) {
      if (cfg[k] !== v) {
        cfg[k] = v;
        changed = true;
      }
    }
    if (!changed) return;
    try {
      const tmp = `${cfgPath}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, cfgPath);
    } catch (err) {
      console.warn('[chat] config.json normalize: write failed:', err.message);
    }
  }

  /** Per-tenant dirs so Claude Code does not read the server user’s ~/.claude (memory, CLAUDE.md, OAuth cache) for another login. */
  function ensureTenantChatClaudeDirs(dataDir) {
    const root = path.join(dataDir, '.claude-chat-runtime');
    const dirs = [
      path.join(root, 'home'),
      path.join(root, 'config'),
      path.join(root, 'xdg', 'config'),
      path.join(root, 'xdg', 'cache'),
      path.join(root, 'xdg', 'share'),
    ];
    for (const d of dirs) {
      try {
        fs.mkdirSync(d, { recursive: true });
      } catch (err) {
        console.warn('[chat] could not mkdir', d, err.message);
      }
    }
    return root;
  }
  
  /** Append registry-backed identity so the model does not “remember” the wrong person from shared auth. */
  function augmentChatSystemPromptWithTenantIdentity(req, basePrompt) {
    if (!req.tenant) return basePrompt;
    const reg = getRegistryReadonly();
    if (!reg) return basePrompt;
    const row = registryDb.findUserSessionSummary(reg, req.tenant.userId);
    if (!row) return basePrompt;
    const loginEsc = String(row.login || '').replace(/`/g, "'");
    const nameEsc = String(row.display_name || row.login || '').replace(/`/g, "'");
    return (
      `${basePrompt}\n\n---\n\n## Signed-in workspace account\n\n` +
      `- Login: \`${loginEsc}\`\n` +
      `- Preferred name (when the user asks who they are, use this): \`${nameEsc}\`\n` +
      '- Do not use names or private facts from another person’s stored assistant profile, global memory, or files outside this workspace. ' +
      'Owner details must come only from workspace files (for example `docs/profile.md`).\n'
    );
  }

  // Platform-owner bypass for the `platform-confidentiality.md` rule: comma-
  // separated registry logins (emails) that are allowed to see the underlying
  // assistant-stack implementation details. Defaults to the app creator.
  const PLATFORM_OWNER_LOGINS = (process.env.BRAIN_PLATFORM_OWNER_LOGINS || 'aidin@wynnset.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  /**
   * True when the current request is from a verified registry login that is
   * on the platform-owner allowlist.
   */
  function isPlatformOwnerRequest(req) {
    if (!PLATFORM_OWNER_LOGINS.length) return false;
    if (!req.tenant) return false;
    const reg = getRegistryReadonly();
    if (!reg) return false;
    const row = registryDb.findUserSessionSummary(reg, req.tenant.userId);
    if (!row) return false;
    const login = String(row.login || '').trim().toLowerCase();
    return !!login && PLATFORM_OWNER_LOGINS.includes(login);
  }
  
  /**
   * Appended to every dashboard chat so the model knows the **absolute** paths
   * of its working directory and tenant data dir. The Claude Code `Write` tool
   * requires an absolute path; without this block the agent has no grounded
   * way to construct one and has been observed fabricating UUID segments
   * (e.g. guessing a `data/users/<wrong-uuid>/workspace/...` prefix). The
   * spawned child's `cwd` and `BRAIN_DATA_DIR` env are already set to these
   * values — we just surface them in-prompt so the agent uses them directly.
   */
  function appendWorkspaceRuntimePaths(req, basePrompt) {
    let wsAbs = '';
    let dataAbs = '';
    try {
      wsAbs = path.resolve(workspaceDirForRequest(req));
    } catch (_) {}
    try {
      dataAbs = path.resolve(tenantDataDirForRequest(req));
    } catch (_) {}
    if (!wsAbs && !dataAbs) return basePrompt;
    const lines = [
      '---',
      '',
      '## Workspace runtime paths (absolute)',
      '',
      'Your tools run with the working directory set to the workspace root listed below. Use these **exact** absolute paths whenever a tool requires one — do **not** guess UUIDs, hostnames, or container paths from memory.',
      '',
    ];
    if (wsAbs) lines.push(`- Workspace root (your \`cwd\`): \`${wsAbs}\``);
    if (dataAbs) lines.push(`- Tenant data dir (\`$BRAIN_DATA_DIR\`, holds \`*.db\` files): \`${dataAbs}\``);
    lines.push('');
    lines.push(
      'Path conventions inside tools:',
      '',
      '- `Read`, `Edit`, `Glob`, `Grep`, and `Bash` resolve **relative** paths against the workspace root, so `owners-inbox/foo.md` works directly.',
      '- The `Write` tool requires an **absolute** path. Build it by joining the workspace root above with your workspace-relative path (for example `' +
        (wsAbs ? `${wsAbs}/owners-inbox/foo.md` : '<workspace-root>/owners-inbox/foo.md') +
        '`). If you are ever unsure, run `pwd` via `Bash` first and use that — never invent the path from prior context.',
      '',
    );
    return `${basePrompt}\n\n${lines.join('\n')}`;
  }

  /** Appended to every dashboard chat — avoid phantom “file saved / exists” claims without tool evidence. */
  function appendWorkspaceFileEvidenceInstructions(basePrompt) {
    const block = [
      '---',
      '',
      '## Workspace files: only claim what tools confirmed (mandatory)',
      '',
      'Do **not** tell the user that a file **exists**, **is saved**, **was written**, **is in the workspace**, or that they **can open** it, unless **one** of these is true:',
      '',
      '1. A **write / create / edit** (or equivalent) tool **succeeded** in **this** turn for that path; or',
      '2. A **read / list / glob** tool in **this** turn returned that path and you are reporting what you actually observed.',
      '',
      'If you are **recommending** a path the user could create, or you **did not** run a successful write: say clearly that the file **does not exist yet** or that you **have not verified** it on disk — do **not** phrase it as already present.',
      'Do **not** infer file existence from earlier chat, memory, documentation, or typical project layout when the user needs the file to actually be there; **use a tool** to verify first if unsure.',
      '',
    ].join('\n');
    return `${basePrompt}\n\n${block}`;
  }

  /** Appended after proprietary rules so every dashboard chat sees manifest rules + optional full `docs/system.md`. */
  function appendDashboardManifestChatGuidance(req, basePrompt) {
    const rules = [
      '---',
      '',
      '## Workspace dashboard manifest (mandatory when relevant)',
      '',
      'If the user asks about **dashboard tabs**, **`dashboard.json`**, **custom pages**, **`action_items.domain`** values (e.g. family, personal), or adding a **Family** / **Personal** area like Career/Finance:',
      '',
      '1. Treat **`docs/system.md`** in this workspace as authoritative — read it (section **Dashboard manifest**) before advising.',
      '2. Valid manifest **`template`** values are: **`career`**, **`finance`**, **`business`**, **`action_domain`**, **`datatable`**, **`sections`**. There is **no** `template: "family"` — use **`"template": "action_domain"`** with **`"domain": "family"`** (and a unique **`slug`**) for a standard action-item tab backed only by **`brain.db`.**',
      '3. Use **`datatable`** / **`sections`** for arbitrary read-only **SQL** over tenant SQLite files — not when the user wants the same **action list** UX as Finance for one domain.',
      '4. Do **not** tell the user to edit **`app/`** server source files to add a domain tab unless they explicitly need a **new template type** not covered in `docs/system.md`.',
      '5. When you tell the user where a workspace file lives, prefer **workspace-relative** paths (`owners-inbox/name.md`, `docs/guide.md`, or root files like `` `Notes.md` ``) so the dashboard can link them in chat. Avoid relying on host paths like `/data/users/.../workspace/...` as the only pointer.',
      '',
    ].join('\n');
    let out = `${basePrompt}\n\n${rules}`;
    try {
      const ws = workspaceDirForRequest(req);
      const docPath = path.join(ws, 'docs', 'system.md');
      if (fs.existsSync(docPath)) {
        const st = fs.statSync(docPath);
        const maxBytes = 24000;
        if (st.isFile() && st.size > 0 && st.size <= maxBytes) {
          const body = fs.readFileSync(docPath, 'utf8');
          out += [
            '---',
            '',
            '## `docs/system.md` (workspace copy for this session)',
            '',
            'If the following diverges from the file on disk, prefer the file the user sees in **`docs/system.md`.**',
            '',
            body,
          ].join('\n');
        }
      }
    } catch (err) {
      console.warn('[chat] dashboard manifest guidance:', err.message);
    }
    return out;
  }
  
  /**
   * Env for the Claude Agent SDK child process.
   * @param {{ tenantDataDir?: string | null, model?: string }} [opts]
   */
  function envForClaudeChat(opts = {}) {
    const env = { ...process.env };
    const modelOverride = opts.model != null && String(opts.model).trim() !== '' ? String(opts.model).trim() : '';
    if (modelOverride) env.ANTHROPIC_MODEL = modelOverride;
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

    const td = opts.tenantDataDir != null ? String(opts.tenantDataDir).trim() : '';
    if (!td) return env;

    // Canonical container path to the tenant's data dir. Subagents (and the
    // `db` CLI) read this instead of guessing or trusting host-machine paths
    // baked into workspace/config.json.
    env.BRAIN_DATA_DIR = path.resolve(td);
    // Always block Claude Code auto-memory / global CLAUDE.md layers so another tenant’s session does not load them.
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
    if (process.env.BRAIN_CHAT_LOAD_CLAUDE_MDS === '1') {
      delete env.CLAUDE_CODE_DISABLE_CLAUDE_MDS;
    } else {
      env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1';
    }
    // OAuth / subscription lives under the real ~/.claude — only isolate HOME when an API key is present (auth does not need ~/.claude).
    if (hasApiKey) {
      ensureTenantChatClaudeDirs(td);
      const root = path.join(td, '.claude-chat-runtime');
      env.HOME = path.join(root, 'home');
      env.CLAUDE_CONFIG_DIR = path.join(root, 'config');
      env.XDG_CONFIG_HOME = path.join(root, 'xdg', 'config');
      env.XDG_CACHE_HOME = path.join(root, 'xdg', 'cache');
      env.XDG_DATA_HOME = path.join(root, 'xdg', 'share');
    } else if (process.env.FLY_APP_NAME) {
      ensureFlyClaudeIsolation();
      env.HOME = '/tmp/brain-fake-home';
      env.CLAUDE_CONFIG_DIR = '/tmp/brain-claude-config';
    }
    return env;
  }
  
  /** UTC calendar date `YYYY-MM-DD` → Monday of that week (UTC), as `YYYY-MM-DD`. */
  function utcMondayOfWeekIsoYmd(isoYmd) {
    const parts = String(isoYmd || '').split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
    const t = Date.UTC(y, mo, d);
    const dow = new Date(t).getUTCDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    return new Date(t + offset * 86400000).toISOString().slice(0, 10);
  }
  
  /** One row per assistant message with Agent SDK `sdkBilling` (timestamp = message `createdAt`, UTC day). */
  function collectChatSdkBillingEventsForUsage(req) {
    ensureChatSessionsDir(req);
    const dir = chatSessionsDirForRequest(req);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (_) {
      return [];
    }
    const events = [];
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (!CHAT_ID_RE.test(id)) continue;
      const sess = readChatSession(req, id);
      if (!sess || !Array.isArray(sess.messages)) continue;
      for (const m of sess.messages) {
        if (!m || m.role !== 'assistant' || !m.sdkBilling) continue;
        const at = m.createdAt;
        if (!at || typeof at !== 'string') continue;
        const day = at.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const b = m.sdkBilling;
        const usd = typeof b.totalCostUsd === 'number' && Number.isFinite(b.totalCostUsd) ? b.totalCostUsd : 0;
        const u = b.usage && typeof b.usage === 'object' ? b.usage : {};
        const ink = typeof u.input_tokens === 'number' && Number.isFinite(u.input_tokens) ? u.input_tokens : 0;
        const outk = typeof u.output_tokens === 'number' && Number.isFinite(u.output_tokens) ? u.output_tokens : 0;
        if (usd === 0 && ink === 0 && outk === 0) continue;
        events.push({ day, totalCostUsd: usd, input_tokens: ink, output_tokens: outk });
      }
    }
    return events;
  }
  
  /** Prefer `sdkUsageSessionTotals.totalCostUsd`; else sum assistant `sdkBilling.totalCostUsd`. */
  function sessionTotalCostUsdFromSession(sess) {
    if (!sess || typeof sess !== 'object') return 0;
    const t = sess.sdkUsageSessionTotals;
    if (t && typeof t.totalCostUsd === 'number' && Number.isFinite(t.totalCostUsd)) return t.totalCostUsd;
    let sum = 0;
    for (const m of sess.messages || []) {
      if (!m || m.role !== 'assistant' || !m.sdkBilling) continue;
      const v = m.sdkBilling.totalCostUsd;
      if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    }
    return sum;
  }
  
  /** Most recently updated chat sessions (for usage UI), each with rollup cost. */
  function listRecentChatSessionsForUsage(req, limit) {
    ensureChatSessionsDir(req);
    const dir = chatSessionsDirForRequest(req);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (_) {
      return [];
    }
    const rows = [];
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (!CHAT_ID_RE.test(id)) continue;
      const sess = readChatSession(req, id);
      if (!sess) continue;
      rows.push({
        id: sess.id || id,
        title: String(sess.title || 'Chat').slice(0, 200),
        agent: typeof sess.agent === 'string' ? sess.agent : '',
        updatedAt: sess.updatedAt || sess.createdAt || '',
        totalCostUsd: sessionTotalCostUsdFromSession(sess),
      });
    }
    rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return rows.slice(0, Math.max(0, Number(limit) || 0));
  }
  
  function buildChatUsageSummary(req) {
    const events = collectChatSdkBillingEventsForUsage(req);
    const lifetime = { totalCostUsd: 0, input_tokens: 0, output_tokens: 0, turns: 0 };
    const dayMap = new Map();
    for (const e of events) {
      lifetime.totalCostUsd += e.totalCostUsd;
      lifetime.input_tokens += e.input_tokens;
      lifetime.output_tokens += e.output_tokens;
      lifetime.turns += 1;
      const cur = dayMap.get(e.day) || { totalCostUsd: 0, input_tokens: 0, output_tokens: 0, turns: 0 };
      cur.totalCostUsd += e.totalCostUsd;
      cur.input_tokens += e.input_tokens;
      cur.output_tokens += e.output_tokens;
      cur.turns += 1;
      dayMap.set(e.day, cur);
    }
    const byDay = [...dayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => b.date.localeCompare(a.date));
  
    const now = new Date();
    const through = now.toISOString().slice(0, 10);
    const monthKey = through.slice(0, 7);
    const weekStart = utcMondayOfWeekIsoYmd(through);
  
    const monthToDate = { month: monthKey, through, totalCostUsd: 0, input_tokens: 0, output_tokens: 0, turns: 0 };
    const weekToDate = { weekStart: weekStart || '', through, totalCostUsd: 0, input_tokens: 0, output_tokens: 0, turns: 0 };
    for (const e of events) {
      if (e.day.startsWith(monthKey)) {
        monthToDate.totalCostUsd += e.totalCostUsd;
        monthToDate.input_tokens += e.input_tokens;
        monthToDate.output_tokens += e.output_tokens;
        monthToDate.turns += 1;
      }
      if (weekStart && e.day >= weekStart && e.day <= through) {
        weekToDate.totalCostUsd += e.totalCostUsd;
        weekToDate.input_tokens += e.input_tokens;
        weekToDate.output_tokens += e.output_tokens;
        weekToDate.turns += 1;
      }
    }
  
    const weekMap = new Map();
    const monthRollMap = new Map();
    for (const row of byDay) {
      const ws = utcMondayOfWeekIsoYmd(row.date);
      if (ws) {
        const w = weekMap.get(ws) || { totalCostUsd: 0, input_tokens: 0, output_tokens: 0, turns: 0 };
        w.totalCostUsd += row.totalCostUsd;
        w.input_tokens += row.input_tokens;
        w.output_tokens += row.output_tokens;
        w.turns += row.turns;
        weekMap.set(ws, w);
      }
      const mk = row.date.slice(0, 7);
      const m = monthRollMap.get(mk) || { totalCostUsd: 0, input_tokens: 0, output_tokens: 0, turns: 0 };
      m.totalCostUsd += row.totalCostUsd;
      m.input_tokens += row.input_tokens;
      m.output_tokens += row.output_tokens;
      m.turns += row.turns;
      monthRollMap.set(mk, m);
    }
    const byWeek = [...weekMap.entries()]
      .map(([weekMonday, v]) => ({ weekMonday, ...v }))
      .sort((a, b) => b.weekMonday.localeCompare(a.weekMonday))
      .slice(0, 52);
    const byMonth = [...monthRollMap.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 36);
  
    return {
      timezone: 'UTC',
      generatedAt: now.toISOString(),
      lifetime,
      monthToDate,
      weekToDate,
      byDay: byDay.slice(0, 120),
      byWeek,
      byMonth,
      recentSessions: listRecentChatSessionsForUsage(req, 50),
    };
  }
  
  app.get('/api/chat/usage-summary', (req, res) => {
    try {
      res.json(buildChatUsageSummary(req));
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // ─── Per-user credit limits (multi-user mode) ────────────────────────────
  //
  // Tracking for these limits lives in `registry.db` — not in any per-tenant
  // DB — so neither the dashboard user nor the agents running on their behalf
  // can edit their own counters. The chat POST handler calls
  // `loadChatLimitState` before accepting a new message and calls
  // `recordChatSpend` after each turn's billing lands.

  /** How many prior monthly cycles to surface on `/api/chat/limits`. */
  const CHAT_MONTH_HISTORY_LIMIT = Math.max(
    1,
    Math.min(120, Number(process.env.BRAIN_CHAT_MONTH_HISTORY_LIMIT) || 12),
  );

  /**
   * Load the current snapshot + exceeded state for the authenticated tenant.
   * Returns `null` when the registry file is missing. When `opts.includeHistory`
   * is true, the snapshot's `monthHistory` array carries up to
   * `CHAT_MONTH_HISTORY_LIMIT` prior monthly cycles (newest first).
   * @param {import('express').Request} req
   * @param {{ includeHistory?: boolean }} [opts]
   */
  function loadChatLimitState(req, opts = {}) {
    if (!req.tenant || !req.tenant.userId) return null;
    if (typeof withRegistryReadWrite !== 'function') return null;
    const snapshotOpts = opts.includeHistory
      ? { monthHistoryLimit: CHAT_MONTH_HISTORY_LIMIT }
      : {};
    return withRegistryReadWrite((db) => {
      const snapshot = registryDb.getUsageSnapshot(db, req.tenant.userId, new Date(), snapshotOpts);
      if (!snapshot) return null;
      const state = registryDb.limitState(snapshot);
      return { snapshot, state };
    });
  }

  /**
   * Record `usd` against the authenticated tenant's counters. Caller passes
   * the billing delta reported for a single assistant turn. No-ops when the
   * amount is not a positive finite number.
   */
  function recordChatSpend(req, usd) {
    const amount = Number(usd);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!req.tenant || !req.tenant.userId) return;
    if (typeof withRegistryReadWrite !== 'function') return;
    try {
      withRegistryReadWrite((db) => registryDb.addUsage(db, req.tenant.userId, amount));
    } catch (err) {
      console.warn('[chat-limits] record spend failed:', err && err.message ? err.message : err);
    }
  }

  /** Public JSON shape used by the dashboard banner + exceeded responses. */
  function limitsPayload(snapshot, state) {
    if (!snapshot) return { enabled: false };
    const over = state && state.exceeded;
    const payload = {
      enabled: true,
      exceeded: Boolean(over),
      exceededKind: over ? state.kind : null,
      resetsAt: over ? state.resetsAt : null,
      dailyLimitUsd: snapshot.dailyLimitUsd,
      monthlyLimitUsd: snapshot.monthlyLimitUsd,
      daySpendUsd: snapshot.daySpendUsd,
      monthSpendUsd: snapshot.monthSpendUsd,
      dayKey: snapshot.dayKey,
      monthPeriodStart: snapshot.monthPeriodStart,
      dayResetsAt: snapshot.dayResetsAt,
      monthResetsAt: snapshot.monthResetsAt,
      accountCreatedAt: snapshot.createdAt,
    };
    if (Array.isArray(snapshot.monthHistory)) payload.monthHistory = snapshot.monthHistory;
    return payload;
  }

  app.get('/api/chat/limits', (req, res) => {
    try {
      const loaded = loadChatLimitState(req, { includeHistory: true });
      if (!loaded) return res.json({ enabled: false });
      return res.json(limitsPayload(loaded.snapshot, loaded.state));
    } catch (err) {
      res.status(500).json({ error: err.message || String(err) });
    }
  });
  
  app.get('/api/chat/conversations', (req, res) => {
    ensureChatSessionsDir(req);
    let files = [];
    try {
      files = fs.readdirSync(chatSessionsDirForRequest(req)).filter(f => f.endsWith('.json'));
    } catch (_) {
      return res.json({ conversations: [] });
    }
    const items = [];
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (!CHAT_ID_RE.test(id)) continue;
      const sess = readChatSession(req, id);
      if (!sess) continue;
      const sum = chatRunRegistry.summary(id);
      const pinnedAt = sess.pinnedAt && typeof sess.pinnedAt === 'string' ? sess.pinnedAt : null;
      items.push({
        id: sess.id,
        agent: sess.agent,
        model: recordedModelForSession(sess),
        title: sess.title || 'Chat',
        updatedAt: sess.updatedAt || sess.createdAt,
        active: USE_CHAT_RUN_REGISTRY ? sum.active : false,
        lastEventSeq: USE_CHAT_RUN_REGISTRY ? sum.lastSeq : 0,
        pinned: Boolean(pinnedAt),
        pinnedAt,
      });
    }
    // Pinned first (most-recently-pinned on top), then everything else by recency.
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return String(b.pinnedAt || '').localeCompare(String(a.pinnedAt || ''));
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    res.json({ conversations: items.slice(0, CHAT_LIST_LIMIT) });
  });
  
  app.get('/api/chat/models', (req, res) => {
    res.json({ models: CHAT_MODEL_CATALOG, defaultModel: getDefaultChatModelId() });
  });

  app.post('/api/chat/conversations', (req, res) => {
    const agent = (req.body && req.body.agent) || '';
    if (!agent) return res.status(400).json({ error: 'Missing agent' });
    const rawModel = req.body && req.body.model != null ? String(req.body.model).trim().toLowerCase() : '';
    const model = rawModel ? (isAllowedChatModelId(rawModel) ? rawModel : null) : getDefaultChatModelId();
    if (rawModel && !model) return res.status(400).json({ error: 'Invalid model' });
    const ws = workspaceDirForRequest(req);
    const systemFile = isOrchestratorChatAgent(agent)
      ? resolveOrchestratorBriefPathInWorkspace(ws)
      : path.join(ws, 'team', `${agent}.md`);
    if (!systemFile || !fs.existsSync(systemFile)) return res.status(404).json({ error: `Agent "${agent}" not found` });
    ensureChatSessionsDir(req);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sess = { id, agent, model: model || getDefaultChatModelId(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] };
    persistChatSession(req, id, sess);
    res.json({ id });
  });
  
  app.get('/api/chat/conversations/:id', (req, res) => {
    const sess = readChatSession(req, req.params.id);
    if (!sess) return res.status(404).json({ error: 'Conversation not found' });
    if (USE_CHAT_RUN_REGISTRY) {
      const sum = chatRunRegistry.summary(req.params.id);
      sess.active = sum.active;
      sess.lastEventSeq = sum.lastSeq;
    }
    res.json(sess);
  });

  app.get('/api/chat/conversations/:id/stream', (req, res) => {
    if (!USE_CHAT_RUN_REGISTRY) {
      return res.status(404).json({ error: 'Chat stream registry is disabled' });
    }
    const convId = String(req.params.id || '');
    if (!CHAT_ID_RE.test(convId)) return res.status(400).json({ error: 'Invalid id' });
    const p = chatSessionPath(req, convId);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Conversation not found' });

    const fromSeqRaw = req.query && req.query.fromSeq != null ? String(req.query.fromSeq) : '0';
    const fromSeq = Math.max(0, Math.floor(Number(fromSeqRaw) || 0));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const tenantKeyForRun = tenantKeyForChatRun(req);
    const detach = chatRunRegistry.attach(convId, res, {
      fromSeq,
      tenantKey: tenantKeyForRun,
      abortRunWhenResponseCloses: false,
    });
    res.on('close', detach);
    res.on('error', (err) => {
      const code = err && err.code;
      if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ERR_STREAM_DESTROYED') return;
      console.warn('[chat] stream response socket error:', err && err.message ? err.message : err);
    });
  });

  app.post('/api/chat/conversations/:id/abort', (req, res) => {
    if (!USE_CHAT_RUN_REGISTRY) {
      return res.json({ ok: true, aborted: false });
    }
    const convId = String(req.params.id || '');
    if (!CHAT_ID_RE.test(convId)) return res.status(400).json({ error: 'Invalid id' });
    const p = chatSessionPath(req, convId);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Conversation not found' });
    chatRunRegistry.abort(convId);
    res.json({ ok: true });
  });

  app.patch('/api/chat/conversations/:id', (req, res) => {
    const id = req.params.id;
    const sess = readChatSession(req, id);
    if (!sess) return res.status(404).json({ error: 'Conversation not found' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const wantsTitle = body.title != null;
    const wantsModel = body.model != null;
    if (!wantsTitle && !wantsModel) {
      return res.status(400).json({ error: 'Provide title and/or model' });
    }
    /** @type {{ ok: true, title?: string, model?: string }} */
    const out = { ok: true };
    if (wantsTitle) {
      const raw = String(body.title);
      const title = raw.trim().slice(0, 200);
      if (!title) return res.status(400).json({ error: 'Title cannot be empty' });
      sess.title = title;
      out.title = sess.title;
    }
    if (wantsModel) {
      const mid = String(body.model).trim().toLowerCase();
      if (!isAllowedChatModelId(mid)) return res.status(400).json({ error: 'Invalid model' });
      sess.model = mid;
      out.model = sess.model;
    }
    sess.updatedAt = new Date().toISOString();
    try {
      persistChatSession(req, id, sess);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not save conversation' });
    }
    res.json(out);
  });

  /**
   * Toggle "pinned" on a conversation so the dashboard can show it in the
   * stacked quick-switch strip above the active chat. Body: `{ pinned: boolean }`.
   */
  app.post('/api/chat/conversations/:id/pin', (req, res) => {
    const id = req.params.id;
    if (!CHAT_ID_RE.test(String(id || ''))) return res.status(400).json({ error: 'Invalid id' });
    const sess = readChatSession(req, id);
    if (!sess) return res.status(404).json({ error: 'Conversation not found' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const pinned = body.pinned === true || body.pinned === 'true';

    if (pinned) {
      sess.pinnedAt = new Date().toISOString();
    } else {
      delete sess.pinnedAt;
    }
    try {
      persistChatSession(req, id, sess);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not update pin state' });
    }
    res.json({ ok: true, pinned: Boolean(sess.pinnedAt), pinnedAt: sess.pinnedAt || null });
  });

  /**
   * Fork:
   * - { messageId } — copy through that assistant reply (inclusive).
   * - { editUserMessageId } — copy messages strictly before that user turn (for edit-and-resend in a new chat; client sends the new text via POST /api/chat).
   */
  app.post('/api/chat/conversations/:id/fork', (req, res) => {
    const sourceId = req.params.id;
    const body = req.body || {};
    const assistantMsgId = body.messageId != null ? String(body.messageId).trim() : '';
    const editUserId = body.editUserMessageId != null ? String(body.editUserMessageId).trim() : '';

    if (assistantMsgId && editUserId) {
      return res.status(400).json({ error: 'Use either messageId or editUserMessageId, not both' });
    }

    if (editUserId) {
      const source = readChatSession(req, sourceId);
      if (!source) return res.status(404).json({ error: 'Conversation not found' });
      const messages = Array.isArray(source.messages) ? source.messages : [];
      const uidx = messages.findIndex((m) => m && String(m.id) === editUserId && m.role === 'user');
      if (uidx < 0) return res.status(400).json({ error: 'User message not found' });

      const prefix = messages.slice(0, uidx);
      const cloned = [];
      for (const m of prefix) {
        const c = cloneMessageForFork(m);
        if (c) cloned.push(c);
      }
      ensureChatSessionsDir(req);
      const now = new Date().toISOString();

      const newId = crypto.randomUUID();
      const model =
        recordedModelForSession({ ...source, messages: cloned }) || getDefaultChatModelId();
      const srcTitle = String(source.title || 'Chat').trim() || 'Chat';
      const title = `Fork · ${srcTitle.length > 120 ? `${srcTitle.slice(0, 117)}…` : srcTitle}`;

      /** @type {Record<string, unknown>} */
      const newSess = {
        id: newId,
        agent: source.agent,
        model,
        title,
        createdAt: now,
        updatedAt: now,
        messages: cloned,
      };

      const totals = sdkTotalsFromMessages(cloned);
      if (totals) newSess.sdkUsageSessionTotals = totals;
      newSess.workspaceTouches = filterTouchesThroughLastMessage(source.workspaceTouches, cloned);

      const userWasLastInSource = uidx === messages.length - 1;
      if (userWasLastInSource) copyPendingPlanIfForkAtSessionTail(newSess, source);
      else stripForkBranchPlanAndResume(newSess);

      try {
        persistChatSession(req, newId, newSess);
      } catch (err) {
        return res.status(500).json({ error: err.message || 'Could not save forked conversation' });
      }
      return res.json({ id: newId });
    }

    if (!assistantMsgId) return res.status(400).json({ error: 'Missing messageId' });
    const source = readChatSession(req, sourceId);
    if (!source) return res.status(404).json({ error: 'Conversation not found' });
    const messages = Array.isArray(source.messages) ? source.messages : [];
    const idx = messages.findIndex((m) => m && String(m.id) === assistantMsgId && m.role === 'assistant');
    if (idx < 0) return res.status(400).json({ error: 'Message not found or not an assistant reply' });

    const slice = messages.slice(0, idx + 1);
    const cloned = [];
    for (const m of slice) {
      const c = cloneMessageForFork(m);
      if (c) cloned.push(c);
    }
    if (!cloned.length) return res.status(400).json({ error: 'Nothing to fork' });

    ensureChatSessionsDir(req);
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    const model =
      recordedModelForSession({ ...source, messages: cloned }) || getDefaultChatModelId();
    const srcTitle = String(source.title || 'Chat').trim() || 'Chat';
    const title = `Fork · ${srcTitle.length > 120 ? `${srcTitle.slice(0, 117)}…` : srcTitle}`;

    /** @type {Record<string, unknown>} */
    const newSess = {
      id: newId,
      agent: source.agent,
      model,
      title,
      createdAt: now,
      updatedAt: now,
      messages: cloned,
    };

    const totals = sdkTotalsFromMessages(cloned);
    if (totals) newSess.sdkUsageSessionTotals = totals;
    newSess.workspaceTouches = filterTouchesThroughLastMessage(source.workspaceTouches, cloned);

    const forkAtTail = idx === messages.length - 1;
    if (forkAtTail) copyPendingPlanIfForkAtSessionTail(newSess, source);
    else stripForkBranchPlanAndResume(newSess);

    try {
      persistChatSession(req, newId, newSess);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not save forked conversation' });
    }
    res.json({ id: newId });
  });

  /**
   * Remove a user message and every message after it (for edit-and-resend in place).
   * Body: { messageId: string } — must be a user message id in the session.
   */
  app.post('/api/chat/conversations/:id/truncate-at-user', (req, res) => {
    const convId = req.params.id;
    const messageId = req.body && req.body.messageId != null ? String(req.body.messageId).trim() : '';
    if (!messageId) return res.status(400).json({ error: 'Missing messageId' });
    const sess = readChatSession(req, convId);
    if (!sess) return res.status(404).json({ error: 'Conversation not found' });
    const messages = Array.isArray(sess.messages) ? sess.messages : [];
    const idx = messages.findIndex((m) => m && String(m.id) === messageId && m.role === 'user');
    if (idx < 0) return res.status(400).json({ error: 'User message not found' });

    sess.messages = messages.slice(0, idx);
    stripForkBranchPlanAndResume(sess);
    sess.workspaceTouches = filterTouchesThroughLastMessage(sess.workspaceTouches, sess.messages);
    const totals = sdkTotalsFromMessages(sess.messages);
    if (totals) sess.sdkUsageSessionTotals = totals;
    else delete sess.sdkUsageSessionTotals;

    const hasUser = sess.messages.some((m) => m && m.role === 'user');
    if (!hasUser) sess.title = 'New chat';

    sess.updatedAt = new Date().toISOString();
    try {
      persistChatSession(req, convId, sess);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not update conversation' });
    }
    res.json({ ok: true });
  });
  
  app.delete('/api/chat/conversations/:id', (req, res) => {
    const convId = String(req.params.id || '');
    const p = chatSessionPath(req, convId);
    if (!p) return res.status(400).json({ error: 'Invalid id' });
    if (USE_CHAT_RUN_REGISTRY) chatRunRegistry.abort(convId);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    try {
      const ws = workspaceDirForRequest(req);
      chatMemory.deleteChatSessionMemoryMirror(ws, convId);
    } catch (err) {
      console.warn('[chat-memory] mirror delete failed:', err && err.message ? err.message : err);
    }
    res.json({ ok: true });
  });
  
  app.post('/api/chat', (req, res) => {
    const body = req.body || {};
    const { agent, prompt, conversationId } = body;
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Missing prompt' });
    if (!conversationId || !CHAT_ID_RE.test(String(conversationId))) {
      return res.status(400).json({ error: 'Missing or invalid conversationId' });
    }

    // First-chat-per-tenant backfill of `memory/chats/` mirrors. Guarded by a
    // marker file so this is a one-time cost; subsequent writes come through
    // the hot path in `persistChatSession`.
    ensureChatMemoryBackfilled(req);

    // Credit limits (multi-user mode): reject before mutating state so a blown
    // limit does not leave an orphaned user message in the session.
    const limitLoaded = loadChatLimitState(req);
    if (limitLoaded && limitLoaded.state.exceeded) {
      const payload = limitsPayload(limitLoaded.snapshot, limitLoaded.state);
      const kindLabel = payload.exceededKind === 'monthly' ? 'monthly' : 'daily';
      const limitUsd = payload.exceededKind === 'monthly' ? payload.monthlyLimitUsd : payload.dailyLimitUsd;
      payload.error =
        `You've hit your ${kindLabel} credit limit of $${Number(limitUsd).toFixed(2)}. ` +
        `New chats are paused until ${payload.resetsAt}.`;
      payload.creditLimitExceeded = true;
      return res.status(402).json(payload);
    }

    const sess = readChatSession(req, conversationId);
    if (!sess) return res.status(404).json({ error: 'Conversation not found' });
  
    const hadPendingPlan =
      sess.planExecutePending === true && sanitizePlanTodoItems(sess.planTodos || []).length > 0;
  
    const planPhase = normalizeChatPlanPhase(body.planPhase);

    /** @type {null | { id: string, title: string, status: string }[]> */
    let chatPlanExecuteTodos = null;
    if (planPhase === 'execute') {
      const fromBody = sanitizePlanTodoItems(body.planTodos);
      const fromSess = sanitizePlanTodoItems(sess.planTodos);
      chatPlanExecuteTodos = fromBody.length ? fromBody : fromSess;
      if (!chatPlanExecuteTodos.length) {
        return res.status(400).json({
          error: 'No plan to execute. Run a plan turn first, or pass planTodos in the request body.',
        });
      }
      if (fromBody.length) {
        sess.planTodos = chatPlanExecuteTodos;
        try {
          persistChatSession(req, conversationId, sess);
        } catch (e) {
          return res.status(500).json({ error: `Could not save plan: ${e.message}` });
        }
      }
    }
  
    const sessionAgent = sess.agent;
    if (agent && agent !== sessionAgent) {
      return res.status(400).json({ error: `Agent must match conversation (${sessionAgent})` });
    }

    const userMsgsBefore = sess.messages.filter((m) => m.role === 'user').length;
    const modelPick = resolveChatModelForRequest(sess, body.model, userMsgsBefore);
    if (!modelPick.ok) return res.status(400).json({ error: modelPick.error });
    sess.model = modelPick.model;
  
    const ws = workspaceDirForRequest(req);
    const systemFile = isOrchestratorChatAgent(sessionAgent)
      ? resolveOrchestratorBriefPathInWorkspace(ws)
      : path.join(ws, 'team', `${sessionAgent}.md`);
    if (!systemFile || !fs.existsSync(systemFile)) return res.status(404).json({ error: `Agent "${sessionAgent}" not found` });
  
    if (!claudeAuthConfiguredOnFly()) {
      const flyApp = process.env.FLY_APP_NAME;
      return res.status(503).json({
        error:
          'Dashboard chat is not configured on this server (the host must set assistant credentials in the deployment environment). ' +
          (flyApp ? `Operator: see repository docs for this Fly app (${flyApp}).` : 'Ask your administrator to enable chat for this deployment.'),
      });
    }
  
    let systemPrompt;
    try {
      systemPrompt = fs.readFileSync(systemFile, 'utf8');
    } catch (err) {
      return res.status(500).json({ error: `Could not read agent file: ${err.message}` });
    }
    systemPrompt = augmentChatSystemPromptWithTenantIdentity(req, systemPrompt);
    const isPlatformOwner = isPlatformOwnerRequest(req);
    if (!isPlatformOwner) {
      systemPrompt = appendPlatformConfidentialityRules(systemPrompt);
    }
    systemPrompt = appendWorkspaceFileEvidenceInstructions(systemPrompt);
    systemPrompt = appendWorkspaceRuntimePaths(req, systemPrompt);
    systemPrompt = appendDashboardManifestChatGuidance(req, systemPrompt);
    if (isOrchestratorChatAgent(sessionAgent)) {
      systemPrompt = appendOrchestratorOperatingRules(systemPrompt);
      systemPrompt = chatMemory.appendMemoryInstructions(systemPrompt);
    }
    if (planPhase === 'plan') systemPrompt += CHAT_PLAN_PHASE_SYSTEM_SUFFIX;
    if (planPhase === 'execute') systemPrompt += CHAT_EXECUTE_PLAN_SYSTEM_SUFFIX;
    if (hadPendingPlan && !planPhase) systemPrompt += CHAT_PLAN_REVISION_CHAT_SUFFIX;

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
      persistChatSession(req, conversationId, sess);
    } catch (err) {
      sess.messages.pop();
      return res.status(500).json({ error: `Could not save message: ${err.message}` });
    }

    console.log(
      `[chat] agent=${sessionAgent} model=${sess.model} conversation=${conversationId}` +
        (planPhase ? ` planPhase=${planPhase}` : '')
    );

    if (USE_CHAT_RUN_REGISTRY) {
      const tenantKeyForRun = tenantKeyForChatRun(req);

      /**
       * @param {(obj: Record<string, unknown>) => void} emit
       * @param {AbortSignal} chatAbortSignal
       */
      async function executeModelRun(emit, chatAbortSignal) {
        const freshSess0 = readChatSession(req, conversationId) || sess;
        emit({ status: 'started', ...(planPhase ? { phase: planPhase } : {}) });

        let assistantBufRun = '';
        let assistantSavedRun = false;
        /** When set, last message in session is a draft assistant turn updated by `flushPartialAssistantToSession`. */
        let partialDraftMsgId = null;
        let lastPartialFlushAt = 0;

        function resolveTurnModelForRun(fresh, assistantModelId) {
          const fromArg =
            assistantModelId != null && String(assistantModelId).trim() && isAllowedChatModelId(String(assistantModelId).trim().toLowerCase())
              ? String(assistantModelId).trim().toLowerCase()
              : '';
          const fromSession =
            fresh.model != null && String(fresh.model).trim() && isAllowedChatModelId(String(fresh.model).trim().toLowerCase())
              ? String(fresh.model).trim().toLowerCase()
              : '';
          return fromSession || fromArg || inferRecordedModelFromMessages(fresh.messages) || getDefaultChatModelId();
        }

        function flushPartialAssistantToSession() {
          if (assistantSavedRun) return;
          const text = String(assistantBufRun || '').trim();
          if (!text) return;
          const fresh = readChatSession(req, conversationId);
          if (!fresh) return;
          const turnModel = resolveTurnModelForRun(fresh, sess.model);
          fresh.model = turnModel;
          const nowIso = new Date().toISOString();
          if (partialDraftMsgId) {
            const d = fresh.messages.find((m) => m && m.id === partialDraftMsgId && m.role === 'assistant');
            if (d) {
              d.content = text;
              d.updatedAt = nowIso;
              d.model = turnModel;
            } else {
              partialDraftMsgId = null;
            }
          }
          if (!partialDraftMsgId) {
            const id = crypto.randomUUID();
            partialDraftMsgId = id;
            fresh.messages.push({
              id,
              role: 'assistant',
              content: text,
              createdAt: nowIso,
              updatedAt: nowIso,
              model: turnModel,
              streamIncomplete: true,
            });
          }
          fresh.updatedAt = nowIso;
          try {
            persistChatSession(req, conversationId, fresh);
          } catch (e) {
            console.warn('[chat] partial assistant persist failed', e.message);
          }
        }

        function maybeThrottleFlushPartial() {
          const now = Date.now();
          if (now - lastPartialFlushAt < CHAT_PARTIAL_FLUSH_MS) return;
          lastPartialFlushAt = now;
          flushPartialAssistantToSession();
        }

        /**
         * @param {Record<string, unknown>} msg
         * @param {null | { userMessageId?: string, totalCostUsd?: number | null, usage?: Record<string, number> | null, modelUsage?: Record<string, Record<string, number>> | null, numTurns?: number, resultSubtype?: string }} billing
         * @param {Record<string, unknown>} fresh
         */
        function applyBillingToAssistantMsgRun(msg, billing, fresh) {
          if (!billing) return;
          const hasUsd = billing.totalCostUsd != null && Number.isFinite(billing.totalCostUsd);
          const hasUsage = billing.usage && typeof billing.usage === 'object' && Object.keys(billing.usage).length > 0;
          const hasModelUsage =
            billing.modelUsage && typeof billing.modelUsage === 'object' && Object.keys(billing.modelUsage).length > 0;
          if (hasUsd || hasUsage || hasModelUsage) {
            msg.sdkBilling = {
              userMessageId: billing.userMessageId,
              totalCostUsd: hasUsd ? billing.totalCostUsd : null,
              usage: hasUsage ? billing.usage : null,
              modelUsage: hasModelUsage ? billing.modelUsage : null,
            };
            if (typeof billing.numTurns === 'number') msg.sdkBilling.numTurns = billing.numTurns;
            if (billing.resultSubtype) msg.sdkBilling.resultSubtype = billing.resultSubtype;
          }
          mergeSdkBillingIntoSessionTotals(fresh, billing);
          if (billing.totalCostUsd != null && Number.isFinite(billing.totalCostUsd) && billing.totalCostUsd > 0) {
            recordChatSpend(req, billing.totalCostUsd);
          }
        }

        function appendAssistantToSessionRun(content, errFlag, billing, assistantModelId) {
          if (assistantSavedRun) return null;
          assistantSavedRun = true;
          const fresh = readChatSession(req, conversationId);
          if (!fresh) return null;
          const turnModel = resolveTurnModelForRun(fresh, assistantModelId);
          fresh.model = turnModel;
          const nowIso = new Date().toISOString();

          let draft = null;
          if (partialDraftMsgId) {
            draft = fresh.messages.find((m) => m && m.id === partialDraftMsgId && m.role === 'assistant') || null;
          }
          if (draft) {
            draft.content = content || '';
            draft.model = turnModel;
            if (errFlag) draft.error = true;
            else delete draft.error;
            delete draft.streamIncomplete;
            draft.updatedAt = nowIso;
            applyBillingToAssistantMsgRun(draft, billing, fresh);
            fresh.updatedAt = nowIso;
            try {
              persistChatSession(req, conversationId, fresh);
              partialDraftMsgId = null;
              return fresh;
            } catch (e) {
              console.warn('[chat] could not save assistant message', e.message);
              return null;
            }
          }

          const msg = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: content || '',
            createdAt: nowIso,
            model: turnModel,
          };
          if (errFlag) msg.error = true;
          applyBillingToAssistantMsgRun(msg, billing, fresh);
          fresh.messages.push(msg);
          fresh.updatedAt = msg.createdAt;
          try {
            persistChatSession(req, conversationId, fresh);
            partialDraftMsgId = null;
            return fresh;
          } catch (e) {
            console.warn('[chat] could not save assistant message', e.message);
            return null;
          }
        }

        let pendingWorkspaceTouches = [];
        chatRunRegistry.setPartialFlush(conversationId, flushPartialAssistantToSession);
        try {
          const runner = await import(pathToFileURL(path.join(__dirname, '..', '..', 'chat-sdk-runner.mjs')).href);
          const freshSess = readChatSession(req, conversationId) || freshSess0;
          const useResume = Boolean(freshSess.agentSdkSessionId && process.env.BRAIN_CHAT_RESUME !== '0');
          let promptText = useResume
            ? lastUserContent(freshSess.messages)
            : formatTranscriptFromMessages(freshSess.messages, CHAT_MAX_TRANSCRIPT_CHARS);
          if (useResume && !String(promptText || '').trim()) {
            promptText = formatTranscriptFromMessages(freshSess.messages, CHAT_MAX_TRANSCRIPT_CHARS);
          }
          if (planPhase === 'execute' && chatPlanExecuteTodos && chatPlanExecuteTodos.length) {
            const block =
              '[Approved plan — execute in order]\n```json\n' +
              JSON.stringify(chatPlanExecuteTodos, null, 2) +
              '\n```';
            promptText = `${block}\n\n${promptText}`;
          }
          const allowedRaw = (process.env.BRAIN_CHAT_ALLOWED_TOOLS || '').trim();
          const allowedTools = allowedRaw ? allowedRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
          const chatEnv = envForClaudeChat({
            tenantDataDir: tenantDataDirForRequest(req),
            model: freshSess.model || sess.model,
          });
          const perm = runner.parsePermissionOptions(process.env.BRAIN_CHAT_PERMISSION_MODE);
          const chatDataDir = tenantDataDirForRequest(req);
          const chatWorkspaceDir = workspaceDirForRequest(req);
          try {
            normalizeWorkspaceConfigDbPaths(chatWorkspaceDir, chatDataDir);
          } catch (err) {
            console.warn('[chat] config.json normalize:', err.message);
          }
          let toolsOpt = runner.parseToolsOption(process.env.BRAIN_CHAT_TOOLS);
          if (planPhase === 'plan') {
            toolsOpt = ['Read', 'Glob', 'Grep'];
          }
          const subagentToolAllow = parseGlobalToolAllowEnv(process.env.BRAIN_CHAT_SUBAGENT_TOOLS);
          let tenantAgents;
          if (isOrchestratorChatAgent(sessionAgent) && planPhase !== 'plan') {
            try {
              tenantAgents = loadTenantAgentDefinitions({
                workspaceDir: chatWorkspaceDir,
                subagentRules: readSubagentOperatingRules(),
                proprietaryBlock: isPlatformOwner ? '' : readPlatformConfidentialityRules(),
                globalToolAllow: subagentToolAllow,
                onWarn: (m) => console.warn(m),
              });
              if (tenantAgents && Object.keys(tenantAgents).length) {
                console.log(
                  `[chat] team-agents loaded for ${sessionAgent} from ${chatWorkspaceDir}/team: ${Object.keys(tenantAgents).sort().join(', ')}`
                );
                const rosterLines = Object.entries(tenantAgents)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([slug, def]) => `- \`${slug}\` — ${def.description || ''}`.trim());
                const rosterBlock = [
                  '## Available team members (as `Task(subagent_type=…)` targets)',
                  '',
                  'These are the exact subagent_type values registered for this workspace.',
                  'When you decide to delegate, you MUST pick one of these slugs — do not',
                  'use `general-purpose` to impersonate a team member via the prompt body.',
                  '',
                  ...rosterLines,
                ].join('\n');
                systemPrompt = `${systemPrompt}\n\n---\n\n${rosterBlock}\n`;
              } else {
                console.warn(
                  `[chat] team-agents: no definitions found in ${chatWorkspaceDir}/team (Cyrus has nothing to delegate to)`
                );
              }
            } catch (err) {
              console.warn('[chat-sdk] team-agents load failed:', err.message);
            }
            if (process.env.BRAIN_CHAT_MCP_BROWSER === '1') {
              attachBrainFetchMcpToTeamAgents(tenantAgents, subagentToolAllow);
            }
          }
          const out = await runner.runAgentSdkQuery({
            prompt: promptText,
            systemPrompt,
            resume: useResume ? freshSess.agentSdkSessionId : undefined,
            cwd: chatWorkspaceDir,
            env: chatEnv,
            model: freshSess.model || sess.model,
            tools: toolsOpt,
            allowedTools,
            permissionMode: perm.permissionMode,
            allowDangerouslySkipPermissions: perm.allowDangerouslySkipPermissions,
            enableMcpBrainDb: process.env.BRAIN_CHAT_MCP_DB === '1',
            enableMcpBrowserFetch: process.env.BRAIN_CHAT_MCP_BROWSER === '1',
            dbDir: chatDataDir,
            auditLogPath: path.join(chatDataDir, 'chat-tool-audit.log'),
            auditTools: process.env.BRAIN_CHAT_AUDIT_TOOLS !== '0',
            maxTurns: Number(process.env.BRAIN_CHAT_MAX_TURNS) || 100,
            pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath() || undefined,
            agentDefinitions: tenantAgents,
            abortSignal: chatAbortSignal,
            onTextChunk: (t) => {
              if (!t) return;
              assistantBufRun = appendAssistantStreamChunk(assistantBufRun, t);
              emit({ text: t });
              maybeThrottleFlushPartial();
            },
            onTool: ({ tool, detail }) => {
              emit({ tool, toolDetail: detail || '' });
            },
            onSegmentAgent: (agentId) => {
              if (agentId) emit({ segmentAgent: String(agentId) });
            },
            onSegmentAgentStart: ({ id, agent }) => {
              if (agent) {
                emit({
                  segmentAgentStart: { id: String(id || ''), agent: String(agent) },
                });
              }
            },
            onSegmentAgentEnd: ({ id, agent, ok }) => {
              if (agent) {
                emit({
                  segmentAgentEnd: {
                    id: String(id || ''),
                    agent: String(agent),
                    ok: ok !== false,
                  },
                });
              }
            },
            onInitSession: (sid) => mergeAgentSdkSessionIntoSession(req, conversationId, sid),
            onPostToolUse: ({ toolName, toolInput }) => {
              appendSdkPostToolTouchesToPending(chatWorkspaceDir, pendingWorkspaceTouches, toolName, toolInput);
            },
          });
          mergePendingWorkspaceTouchesIntoSession(req, conversationId, pendingWorkspaceTouches);
          if (!assistantSavedRun) {
            // Prefer the fully streamed buffer (includes intermediate "let me check…" narration
            // between tool calls) over the SDK's collapsed `finalText`, so the saved transcript
            // matches what the user just watched stream in — no transient context gets overwritten.
            let content = (assistantBufRun || out.finalText || '').trim();
            if (!content && out.errors && out.errors.length) content = out.errors.join('\n');
            if (!content && out.hadError) content = '[Assistant finished with errors]';
            const b = out.sdkBilling;
            const billing =
              b &&
              (b.totalCostUsd != null ||
                (b.usage && Object.keys(b.usage).length > 0) ||
                (b.modelUsage && Object.keys(b.modelUsage).length > 0))
                ? { ...b, userMessageId: userMsg.id }
                : null;
            const saved = appendAssistantToSessionRun(content || '', Boolean(out.hadError), billing, freshSess.model || sess.model);
            if (saved && billing) {
              const last = saved.messages[saved.messages.length - 1];
              emit({
                sdkBilling: last && last.sdkBilling ? last.sdkBilling : billing,
                sdkUsageSessionTotals: saved.sdkUsageSessionTotals || null,
              });
            }
            if (!out.hadError) {
              if (planPhase === 'plan') {
                let planTodos = parseBrainPlanTodosFromAssistantText(content || '');
                const planMarkdown = readBrainChatPlanMarkdown(chatWorkspaceDir);
                if (!planTodos.length && planMarkdown) planTodos = todosFromMarkdownFallback(planMarkdown);
                const planInboxFile = writeChatPlanMarkdownToOwnersInbox(chatWorkspaceDir, conversationId, {
                  planTodos,
                  planMarkdown,
                  assistantContent: content || '',
                  sessionTitle: freshSess.title || sess.title || 'Chat',
                });
                persistChatPlanToSession(req, conversationId, {
                  planTodos,
                  planMarkdown,
                  lastPhase: 'plan',
                  planInboxFile,
                });
                if (planInboxFile && planInboxFile.touchKind) {
                  mergePendingWorkspaceTouchesIntoSession(req, conversationId, [
                    { path: `owners-inbox/${String(planInboxFile.name)}`, kind: planInboxFile.touchKind },
                  ]);
                }
                const mdOut =
                  planMarkdown.length > 12000 ? `${planMarkdown.slice(0, 12000)}\n…` : planMarkdown;
                emit({
                  phase: 'plan',
                  planTodos,
                  planMarkdown: mdOut,
                  planInboxFile,
                });
              }
              if (planPhase === 'execute' && chatPlanExecuteTodos && chatPlanExecuteTodos.length) {
                persistChatPlanToSession(req, conversationId, {
                  planTodos: chatPlanExecuteTodos,
                  lastPhase: 'execute',
                });
                emit({
                  phase: 'execute',
                  planTodos: chatPlanExecuteTodos,
                });
              }
              if (!planPhase && /```brain_plan/i.test(content || '')) {
                const planTodosChat = parseBrainPlanTodosFromAssistantText(content || '', hadPendingPlan);
                if (planTodosChat.length) {
                  const mdChat = readBrainChatPlanMarkdown(chatWorkspaceDir);
                  const planInboxFileChat = writeChatPlanMarkdownToOwnersInbox(chatWorkspaceDir, conversationId, {
                    planTodos: planTodosChat,
                    planMarkdown: mdChat,
                    assistantContent: content || '',
                    sessionTitle: freshSess.title || sess.title || 'Chat',
                  });
                  persistChatPlanToSession(req, conversationId, {
                    planTodos: planTodosChat,
                    planMarkdown: mdChat,
                    lastPhase: 'plan',
                    planInboxFile: planInboxFileChat,
                  });
                  if (planInboxFileChat && planInboxFileChat.touchKind) {
                    mergePendingWorkspaceTouchesIntoSession(req, conversationId, [
                      { path: `owners-inbox/${String(planInboxFileChat.name)}`, kind: planInboxFileChat.touchKind },
                    ]);
                  }
                  const mdOut =
                    mdChat.length > 12000 ? `${mdChat.slice(0, 12000)}\n…` : mdChat;
                  emit({
                    phase: 'plan',
                    planTodos: planTodosChat,
                    planMarkdown: mdOut,
                    planInboxFile: planInboxFileChat,
                  });
                }
              }
            }
          }
          if (out.sessionId) mergeAgentSdkSessionIntoSession(req, conversationId, out.sessionId);
        } catch (err) {
          mergePendingWorkspaceTouchesIntoSession(req, conversationId, pendingWorkspaceTouches);
          const errText = err && err.message ? err.message : String(err);
          console.error('[chat-sdk]', err);
          emit({ error: errText });
          try {
            flushPartialAssistantToSession();
          } catch (_) {}
          const partial = String(assistantBufRun || '').trim();
          const combined = partial ? `${partial}\n\n[Error] ${errText}` : `[Error] ${errText}`;
          appendAssistantToSessionRun(combined, true, null, sess.model);
          throw err;
        } finally {
          chatRunRegistry.clearPartialFlush(conversationId);
        }
      }

      try {
        chatRunRegistry.start({
          convId: conversationId,
          tenantKey: tenantKeyForRun,
          startedAtMs: Date.now(),
          runFn: (emit, signal) => executeModelRun(emit, signal),
        });
      } catch (e) {
        if (e instanceof RunAlreadyActiveError) {
          try {
            const fr = readChatSession(req, conversationId);
            if (fr && Array.isArray(fr.messages) && fr.messages.length) {
              const last = fr.messages[fr.messages.length - 1];
              if (last && last.role === 'user' && last.id === userMsg.id) {
                fr.messages.pop();
                const hasUser = fr.messages.some((m) => m && m.role === 'user');
                if (!hasUser) fr.title = 'New chat';
                fr.updatedAt = new Date().toISOString();
                persistChatSession(req, conversationId, fr);
              }
            }
          } catch (rbErr) {
            console.warn('[chat] rollback user message after 409 failed:', rbErr.message);
          }
          return res.status(409).json({ error: 'A response is still being generated for this chat.' });
        }
        throw e;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const detach = chatRunRegistry.attach(conversationId, res, {
        fromSeq: 0,
        tenantKey: tenantKeyForRun,
        abortRunWhenResponseCloses: false,
      });
      res.on('close', detach);
      res.on('error', (err) => {
        const code = err && err.code;
        if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ERR_STREAM_DESTROYED') return;
        console.warn('[chat] response socket error:', err && err.message ? err.message : err);
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const startedAt = Date.now();
    let heartbeatTimer = null;
    let streamEnded = false;
    let assistantBuf = '';
    let assistantSaved = false;
    const chatAbort = new AbortController();
  
    function clearHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  
    /**
     * @param {string} content
     * @param {boolean} errFlag
     * @param {null | { userMessageId?: string, totalCostUsd?: number | null, usage?: Record<string, number> | null, modelUsage?: Record<string, Record<string, number>> | null, numTurns?: number, resultSubtype?: string }} [billing] Agent SDK snapshot for this assistant turn
     * @param {string} assistantModelId Catalog model id used for this assistant turn (stored on the message and session).
     * @returns {null | Record<string, unknown>} Saved session, or null if nothing was written
     */
    function appendAssistantToSession(content, errFlag, billing, assistantModelId) {
      if (assistantSaved) return null;
      assistantSaved = true;
      const fresh = readChatSession(req, conversationId);
      if (!fresh) return null;
      const fromArg =
        assistantModelId != null && String(assistantModelId).trim() && isAllowedChatModelId(String(assistantModelId).trim().toLowerCase())
          ? String(assistantModelId).trim().toLowerCase()
          : '';
      const fromSession =
        fresh.model != null && String(fresh.model).trim() && isAllowedChatModelId(String(fresh.model).trim().toLowerCase())
          ? String(fresh.model).trim().toLowerCase()
          : '';
      const turnModel = fromSession || fromArg || inferRecordedModelFromMessages(fresh.messages) || getDefaultChatModelId();
      fresh.model = turnModel;
      const msg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: content || '',
        createdAt: new Date().toISOString(),
        model: turnModel,
      };
      if (errFlag) msg.error = true;
      if (billing) {
        const hasUsd = billing.totalCostUsd != null && Number.isFinite(billing.totalCostUsd);
        const hasUsage = billing.usage && typeof billing.usage === 'object' && Object.keys(billing.usage).length > 0;
        const hasModelUsage =
          billing.modelUsage && typeof billing.modelUsage === 'object' && Object.keys(billing.modelUsage).length > 0;
        if (hasUsd || hasUsage || hasModelUsage) {
          msg.sdkBilling = {
            userMessageId: billing.userMessageId,
            totalCostUsd: hasUsd ? billing.totalCostUsd : null,
            usage: hasUsage ? billing.usage : null,
            modelUsage: hasModelUsage ? billing.modelUsage : null,
          };
          if (typeof billing.numTurns === 'number') msg.sdkBilling.numTurns = billing.numTurns;
          if (billing.resultSubtype) msg.sdkBilling.resultSubtype = billing.resultSubtype;
        }
        mergeSdkBillingIntoSessionTotals(fresh, billing);
        if (billing.totalCostUsd != null && Number.isFinite(billing.totalCostUsd) && billing.totalCostUsd > 0) {
          recordChatSpend(req, billing.totalCostUsd);
        }
      }
      fresh.messages.push(msg);
      fresh.updatedAt = msg.createdAt;
      try {
        persistChatSession(req, conversationId, fresh);
        return fresh;
      } catch (e) {
        console.warn('[chat] could not save assistant message', e.message);
        return null;
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
      const startPayload = { status: 'started' };
      if (planPhase) startPayload.phase = planPhase;
      res.write(`data: ${JSON.stringify(startPayload)}\n\n`);
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
  
    res.on('close', () => {
      clearHeartbeat();
      try {
        chatAbort.abort();
      } catch (_) {}
    });
    // Client-disconnect mid-stream triggers EPIPE on the response socket; the
    // default Node behavior is to treat the unhandled 'error' as fatal. We
    // already abort the run via 'close' above, so just log and move on.
    res.on('error', (err) => {
      const code = err && err.code;
      if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ERR_STREAM_DESTROYED') return;
      console.warn('[chat] response socket error:', err && err.message ? err.message : err);
    });
  
    (async () => {
      let pendingWorkspaceTouches = [];
      try {
        const runner = await import(pathToFileURL(path.join(__dirname, '..', '..', 'chat-sdk-runner.mjs')).href);
        const freshSess = readChatSession(req, conversationId) || sess;
        const useResume = Boolean(freshSess.agentSdkSessionId && process.env.BRAIN_CHAT_RESUME !== '0');
        let promptText = useResume
          ? lastUserContent(freshSess.messages)
          : formatTranscriptFromMessages(freshSess.messages, CHAT_MAX_TRANSCRIPT_CHARS);
        if (useResume && !String(promptText || '').trim()) {
          promptText = formatTranscriptFromMessages(freshSess.messages, CHAT_MAX_TRANSCRIPT_CHARS);
        }
        if (planPhase === 'execute' && chatPlanExecuteTodos && chatPlanExecuteTodos.length) {
          const block =
            '[Approved plan — execute in order]\n```json\n' +
            JSON.stringify(chatPlanExecuteTodos, null, 2) +
            '\n```';
          promptText = `${block}\n\n${promptText}`;
        }
        const allowedRaw = (process.env.BRAIN_CHAT_ALLOWED_TOOLS || '').trim();
        const allowedTools = allowedRaw ? allowedRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
        const chatEnv = envForClaudeChat({
          tenantDataDir: tenantDataDirForRequest(req),
          model: sess.model,
        });
          const perm = runner.parsePermissionOptions(process.env.BRAIN_CHAT_PERMISSION_MODE);
          const chatDataDir = tenantDataDirForRequest(req);
          const chatWorkspaceDir = workspaceDirForRequest(req);
          // Keep the workspace config's DB paths in sync with the runtime data
          // dir so Bash + sqlite3 subagents (Ledger, Charter, Arc) can read one
          // key and get a path that exists in this container. Without this,
          // configs migrated from a local install still hold host paths and
          // sqlite3 silently creates an empty DB at the bogus path.
          try {
            normalizeWorkspaceConfigDbPaths(chatWorkspaceDir, chatDataDir);
          } catch (err) {
            console.warn('[chat] config.json normalize:', err.message);
          }
          let toolsOpt = runner.parseToolsOption(process.env.BRAIN_CHAT_TOOLS);
          if (planPhase === 'plan') {
            toolsOpt = ['Read', 'Glob', 'Grep'];
          }
          // Programmatic subagent registration: only wire up team/<name>.md
          // handoffs when the user is chatting with Cyrus. Direct chats with a
          // named team member stay single-agent — no fan-out from Dash to
          // Ledger (etc.) during a one-on-one. Plan mode is read-only so we
          // skip it there too (no writes means no useful delegation work).
          const subagentToolAllow = parseGlobalToolAllowEnv(process.env.BRAIN_CHAT_SUBAGENT_TOOLS);
          let tenantAgents;
          if (isOrchestratorChatAgent(sessionAgent) && planPhase !== 'plan') {
            try {
              tenantAgents = loadTenantAgentDefinitions({
                workspaceDir: chatWorkspaceDir,
                subagentRules: readSubagentOperatingRules(),
                proprietaryBlock: isPlatformOwner ? '' : readPlatformConfidentialityRules(),
                globalToolAllow: subagentToolAllow,
                onWarn: (m) => console.warn(m),
              });
              if (tenantAgents && Object.keys(tenantAgents).length) {
                console.log(
                  `[chat] team-agents loaded for ${sessionAgent} from ${chatWorkspaceDir}/team: ${Object.keys(tenantAgents).sort().join(', ')}`
                );
                // Inject an explicit roster into Cyrus's system prompt so the
                // model has the valid `subagent_type` slugs in-prompt, not
                // only via the Task tool schema. Without this, some model
                // variants fall back to `general-purpose` and impersonate the
                // specialist via the prompt body instead of actually
                // delegating.
                const rosterLines = Object.entries(tenantAgents)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([slug, def]) => `- \`${slug}\` — ${def.description || ''}`.trim());
                const rosterBlock = [
                  '## Available team members (as `Task(subagent_type=…)` targets)',
                  '',
                  'These are the exact subagent_type values registered for this workspace.',
                  'When you decide to delegate, you MUST pick one of these slugs — do not',
                  'use `general-purpose` to impersonate a team member via the prompt body.',
                  '',
                  ...rosterLines,
                ].join('\n');
                systemPrompt = `${systemPrompt}\n\n---\n\n${rosterBlock}\n`;
              } else {
                console.warn(
                  `[chat] team-agents: no definitions found in ${chatWorkspaceDir}/team (Cyrus has nothing to delegate to)`
                );
              }
            } catch (err) {
              console.warn('[chat-sdk] team-agents load failed:', err.message);
            }
            if (process.env.BRAIN_CHAT_MCP_BROWSER === '1') {
              attachBrainFetchMcpToTeamAgents(tenantAgents, subagentToolAllow);
            }
          }
          const out = await runner.runAgentSdkQuery({
            prompt: promptText,
            systemPrompt,
            resume: useResume ? freshSess.agentSdkSessionId : undefined,
            cwd: chatWorkspaceDir,
            env: chatEnv,
            model: sess.model,
            tools: toolsOpt,
            allowedTools,
            permissionMode: perm.permissionMode,
            allowDangerouslySkipPermissions: perm.allowDangerouslySkipPermissions,
            enableMcpBrainDb: process.env.BRAIN_CHAT_MCP_DB === '1',
            enableMcpBrowserFetch: process.env.BRAIN_CHAT_MCP_BROWSER === '1',
            dbDir: chatDataDir,
            auditLogPath: path.join(chatDataDir, 'chat-tool-audit.log'),
            auditTools: process.env.BRAIN_CHAT_AUDIT_TOOLS !== '0',
            maxTurns: Number(process.env.BRAIN_CHAT_MAX_TURNS) || 100,
            pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath() || undefined,
            agentDefinitions: tenantAgents,
            abortSignal: chatAbort.signal,
            onTextChunk: (t) => {
              if (!t) return;
              assistantBuf = appendAssistantStreamChunk(assistantBuf, t);
              try {
                res.write(`data: ${JSON.stringify({ text: t })}\n\n`);
              } catch (_) {}
            },
            onTool: ({ tool, detail }) => {
              try {
                res.write(`data: ${JSON.stringify({ tool, toolDetail: detail || '' })}\n\n`);
              } catch (_) {}
            },
            onSegmentAgent: (agentId) => {
              try {
                if (agentId) res.write(`data: ${JSON.stringify({ segmentAgent: String(agentId) })}\n\n`);
              } catch (_) {}
            },
            onSegmentAgentStart: ({ id, agent }) => {
              try {
                if (agent) {
                  res.write(
                    `data: ${JSON.stringify({
                      segmentAgentStart: { id: String(id || ''), agent: String(agent) },
                    })}\n\n`
                  );
                }
              } catch (_) {}
            },
            onSegmentAgentEnd: ({ id, agent, ok }) => {
              try {
                if (agent) {
                  res.write(
                    `data: ${JSON.stringify({
                      segmentAgentEnd: {
                        id: String(id || ''),
                        agent: String(agent),
                        ok: ok !== false,
                      },
                    })}\n\n`
                  );
                }
              } catch (_) {}
            },
            onInitSession: (sid) => mergeAgentSdkSessionIntoSession(req, conversationId, sid),
            onPostToolUse: ({ toolName, toolInput }) => {
              appendSdkPostToolTouchesToPending(chatWorkspaceDir, pendingWorkspaceTouches, toolName, toolInput);
            },
          });
          mergePendingWorkspaceTouchesIntoSession(req, conversationId, pendingWorkspaceTouches);
          if (!assistantSaved) {
            // Prefer the fully streamed buffer (includes intermediate "let me check…" narration
            // between tool calls) over the SDK's collapsed `finalText`, so the saved transcript
            // matches what the user just watched stream in — no transient context gets overwritten.
            let content = (assistantBuf || out.finalText || '').trim();
            if (!content && out.errors && out.errors.length) content = out.errors.join('\n');
            if (!content && out.hadError) content = '[Assistant finished with errors]';
            const b = out.sdkBilling;
            const billing =
              b &&
              (b.totalCostUsd != null ||
                (b.usage && Object.keys(b.usage).length > 0) ||
                (b.modelUsage && Object.keys(b.modelUsage).length > 0))
                ? { ...b, userMessageId: userMsg.id }
                : null;
            const saved = appendAssistantToSession(content || '', Boolean(out.hadError), billing, sess.model);
            if (saved && billing) {
              const last = saved.messages[saved.messages.length - 1];
              try {
                res.write(
                  `data: ${JSON.stringify({
                    sdkBilling: last && last.sdkBilling ? last.sdkBilling : billing,
                    sdkUsageSessionTotals: saved.sdkUsageSessionTotals || null,
                  })}\n\n`
                );
              } catch (_) {}
            }
            if (!out.hadError) {
              if (planPhase === 'plan') {
                let planTodos = parseBrainPlanTodosFromAssistantText(content || '');
                const planMarkdown = readBrainChatPlanMarkdown(chatWorkspaceDir);
                if (!planTodos.length && planMarkdown) planTodos = todosFromMarkdownFallback(planMarkdown);
                const planInboxFile = writeChatPlanMarkdownToOwnersInbox(chatWorkspaceDir, conversationId, {
                  planTodos,
                  planMarkdown,
                  assistantContent: content || '',
                  sessionTitle: sess.title || 'Chat',
                });
                persistChatPlanToSession(req, conversationId, {
                  planTodos,
                  planMarkdown,
                  lastPhase: 'plan',
                  planInboxFile,
                });
                if (planInboxFile && planInboxFile.touchKind) {
                  mergePendingWorkspaceTouchesIntoSession(req, conversationId, [
                    { path: `owners-inbox/${String(planInboxFile.name)}`, kind: planInboxFile.touchKind },
                  ]);
                }
                try {
                  const mdOut =
                    planMarkdown.length > 12000 ? `${planMarkdown.slice(0, 12000)}\n…` : planMarkdown;
                  res.write(
                    `data: ${JSON.stringify({
                      phase: 'plan',
                      planTodos,
                      planMarkdown: mdOut,
                      planInboxFile,
                    })}\n\n`
                  );
                } catch (_) {}
              }
              if (planPhase === 'execute' && chatPlanExecuteTodos && chatPlanExecuteTodos.length) {
                persistChatPlanToSession(req, conversationId, {
                  planTodos: chatPlanExecuteTodos,
                  lastPhase: 'execute',
                });
                try {
                  res.write(
                    `data: ${JSON.stringify({
                      phase: 'execute',
                      planTodos: chatPlanExecuteTodos,
                    })}\n\n`
                  );
                } catch (_) {}
              }
              if (!planPhase && /```brain_plan/i.test(content || '')) {
                const planTodosChat = parseBrainPlanTodosFromAssistantText(content || '', hadPendingPlan);
                if (planTodosChat.length) {
                  const mdChat = readBrainChatPlanMarkdown(chatWorkspaceDir);
                  const planInboxFileChat = writeChatPlanMarkdownToOwnersInbox(chatWorkspaceDir, conversationId, {
                    planTodos: planTodosChat,
                    planMarkdown: mdChat,
                    assistantContent: content || '',
                    sessionTitle: sess.title || 'Chat',
                  });
                  persistChatPlanToSession(req, conversationId, {
                    planTodos: planTodosChat,
                    planMarkdown: mdChat,
                    lastPhase: 'plan',
                    planInboxFile: planInboxFileChat,
                  });
                  if (planInboxFileChat && planInboxFileChat.touchKind) {
                    mergePendingWorkspaceTouchesIntoSession(req, conversationId, [
                      { path: `owners-inbox/${String(planInboxFileChat.name)}`, kind: planInboxFileChat.touchKind },
                    ]);
                  }
                  try {
                    const mdOut =
                      mdChat.length > 12000 ? `${mdChat.slice(0, 12000)}\n…` : mdChat;
                    res.write(
                      `data: ${JSON.stringify({
                        phase: 'plan',
                        planTodos: planTodosChat,
                        planMarkdown: mdOut,
                        planInboxFile: planInboxFileChat,
                      })}\n\n`
                    );
                  } catch (_) {}
                }
              }
            }
          }
          if (out.sessionId) mergeAgentSdkSessionIntoSession(req, conversationId, out.sessionId);
        } catch (err) {
          mergePendingWorkspaceTouchesIntoSession(req, conversationId, pendingWorkspaceTouches);
          const errText = err && err.message ? err.message : String(err);
          console.error('[chat-sdk]', err);
          try {
            res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
          } catch (_) {}
          appendAssistantToSession(`[Error] ${errText}`, true, null, sess.model);
        } finally {
          endSSE();
        }
    })();
  });

  ctx.chatShutdownFlush = () => {
    chatRunRegistry.flushAllPartialsSync();
  };
};
