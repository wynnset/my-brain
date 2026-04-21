'use strict';

/**
 * Chat memory mirrors — expose past chat transcripts to the agent via the
 * workspace filesystem, so Cyrus (and any subagent running with read-only
 * tools) can Grep / Read them the same way it Greps `owners-inbox/` or
 * `docs/`.
 *
 * Problem it solves
 * -----------------
 *
 * Chat sessions are persisted as JSON files under `<tenantDataDir>/chat-sessions/`
 * — a sibling of the tenant workspace, outside the agent's `cwd`. The agent has
 * no way to reach them. So every new chat starts amnesiac: nothing from last
 * week's thread surfaces in today's, even when the same topic comes up.
 *
 * This module writes a parallel **markdown mirror** of every chat session under
 * `<workspaceDir>/memory/chats/<conversation-id>.md`. The mirror is:
 *
 *   - clean transcript, not the raw JSON (Grep-friendly — no field noise)
 *   - inside the agent's `cwd`, so `Grep`/`Read`/`Glob` Just Work
 *   - regenerated on every session write (atomic tmp + rename)
 *   - deleted when the conversation is deleted
 *   - backfilled lazily from existing JSON sessions on first chat per tenant
 *
 * No embeddings, no vector store, no new dependencies. Pair this with the
 * memory-librarian instructions appended to Cyrus's system prompt (see
 * `memoryInstructionsBlock`) and the chat gains cross-session recall.
 *
 * Feature flag: set `BRAIN_CHAT_MEMORY=0` to disable all mirror writes and the
 * instructions block (emergency rollback without a redeploy).
 *
 * @module app/server/chat/chat-memory
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR_NAME = 'memory';
const CHATS_SUBDIR_NAME = 'chats';
const BACKFILL_MARKER_FILE = '.backfilled';
const CHAT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isFeatureDisabled() {
  return process.env.BRAIN_CHAT_MEMORY === '0';
}

/** `<workspaceDir>/memory/chats` — where transcript mirrors live. */
function memoryChatsDir(workspaceDir) {
  return path.join(workspaceDir, MEMORY_DIR_NAME, CHATS_SUBDIR_NAME);
}

/** Stable per-conversation mirror path (no slug, survives title renames). */
function memoryChatFilePath(workspaceDir, conversationId) {
  return path.join(memoryChatsDir(workspaceDir), `${conversationId}.md`);
}

function ensureMemoryChatsDir(workspaceDir) {
  const dir = memoryChatsDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function atomicWriteUtf8(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

function safeIsoOrEmpty(v) {
  const s = v == null ? '' : String(v).trim();
  return s;
}

/**
 * Render a chat session (as stored under `chat-sessions/<id>.json`) into a
 * transcript markdown document.
 *
 * Format is optimized for Grep, not for pretty rendering:
 *   - metadata frontmatter as a bullet list (simple, literal, searchable)
 *   - one `## User · <iso>` or `## Assistant (<model>) · <iso>` header per turn
 *   - content is inlined verbatim — no fences, no escape munging, so keyword
 *     matches (e.g. "TD Visa", "Suzanne", "EI income") fire directly.
 *
 * @param {{ id?: string, agent?: string, model?: string, title?: string,
 *          createdAt?: string, updatedAt?: string,
 *          messages?: Array<{ role?: string, content?: string, createdAt?: string, model?: string, error?: boolean }>
 *         }} sess
 */
function renderSessionToMarkdown(sess) {
  if (!sess || typeof sess !== 'object') return '';
  const id = safeIsoOrEmpty(sess.id);
  const agent = safeIsoOrEmpty(sess.agent) || 'unknown';
  const model = safeIsoOrEmpty(sess.model) || '';
  const title = safeIsoOrEmpty(sess.title) || 'Chat';
  const createdAt = safeIsoOrEmpty(sess.createdAt);
  const updatedAt = safeIsoOrEmpty(sess.updatedAt) || createdAt;
  const messages = Array.isArray(sess.messages) ? sess.messages : [];

  const userTurns = messages.filter((m) => m && m.role === 'user').length;
  const assistantTurns = messages.filter((m) => m && m.role === 'assistant').length;

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- conversation: ${id}`);
  lines.push(`- agent: ${agent}`);
  if (model) lines.push(`- model: ${model}`);
  if (createdAt) lines.push(`- created: ${createdAt}`);
  if (updatedAt) lines.push(`- updated: ${updatedAt}`);
  lines.push(`- turns: ${userTurns} user / ${assistantTurns} assistant`);
  lines.push('');
  lines.push('_This file mirrors a dashboard chat session so the agent can find');
  lines.push('prior context via Grep/Read. Edits here do not change the live session._');
  lines.push('');

  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const when = safeIsoOrEmpty(m.createdAt);
    const content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'user') {
      lines.push(`## User · ${when}`.trim());
    } else {
      const mm = safeIsoOrEmpty(m.model);
      const marker = m.error === true ? ' [error]' : '';
      lines.push(
        mm
          ? `## Assistant (${mm})${marker} · ${when}`.trim()
          : `## Assistant${marker} · ${when}`.trim()
      );
    }
    lines.push('');
    lines.push(content.trim() || '_(empty)_');
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

/**
 * Write a single chat-session mirror. No-op when the feature is disabled or
 * the session has no conversation id. Errors are caught by the caller
 * (`mirrorChatSessionSafely`) so a mirror failure never blocks the live chat.
 *
 * @param {string} workspaceDir
 * @param {Record<string, unknown>} sess
 * @returns {string | null} Absolute path written, or null.
 */
function writeChatSessionMemoryMirror(workspaceDir, sess) {
  if (isFeatureDisabled()) return null;
  if (!workspaceDir || !sess || typeof sess !== 'object') return null;
  const id = safeIsoOrEmpty(sess.id);
  if (!CHAT_ID_RE.test(id)) return null;
  const md = renderSessionToMarkdown(sess);
  if (!md) return null;
  const full = memoryChatFilePath(workspaceDir, id);
  atomicWriteUtf8(full, md);
  return full;
}

/**
 * Remove the mirror for a deleted conversation. Idempotent.
 *
 * @param {string} workspaceDir
 * @param {string} conversationId
 */
function deleteChatSessionMemoryMirror(workspaceDir, conversationId) {
  if (isFeatureDisabled()) return;
  if (!workspaceDir) return;
  const id = safeIsoOrEmpty(conversationId);
  if (!CHAT_ID_RE.test(id)) return;
  const full = memoryChatFilePath(workspaceDir, id);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
  } catch (err) {
    // Swallow — the live chat already completed; mirror cleanup is best-effort.
    console.warn('[chat-memory] mirror unlink failed:', err && err.message ? err.message : err);
  }
}

/**
 * One-shot backfill: for every chat-session JSON in `chatSessionsDir`, write
 * the mirror if it is missing or stale. Uses a `.backfilled` marker so the
 * full scan runs once per tenant; subsequent writes come through the hot
 * path in `writeChatSessionMemoryMirror`.
 *
 * Intended to be invoked lazily from the chat route on first use per tenant —
 * see `ensureChatMemoryBackfilled` in `routes/chat.js`. Safe to call often;
 * the marker short-circuits.
 *
 * @param {object} opts
 * @param {string} opts.chatSessionsDir     `<tenantDataDir>/chat-sessions`
 * @param {string} opts.workspaceDir        Tenant workspace root.
 * @param {(id: string) => Record<string, unknown> | null} opts.readOneSession
 *   Delegated reader so we inherit the route's JSON sanitizer.
 * @returns {{ ran: boolean, written: number, skipped: number, errors: number }}
 */
function backfillChatSessionMemoryMirrors(opts) {
  const out = { ran: false, written: 0, skipped: 0, errors: 0 };
  if (isFeatureDisabled()) return out;
  const { chatSessionsDir, workspaceDir, readOneSession } = opts || {};
  if (!chatSessionsDir || !workspaceDir || typeof readOneSession !== 'function') return out;
  let dirExists = false;
  try {
    dirExists = fs.existsSync(chatSessionsDir) && fs.statSync(chatSessionsDir).isDirectory();
  } catch (_) {}
  if (!dirExists) return out;

  const memoryDir = ensureMemoryChatsDir(workspaceDir);
  const marker = path.join(memoryDir, BACKFILL_MARKER_FILE);
  if (fs.existsSync(marker)) return out;

  out.ran = true;
  let files = [];
  try {
    files = fs.readdirSync(chatSessionsDir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    out.errors += 1;
    console.warn('[chat-memory] backfill readdir failed:', err && err.message ? err.message : err);
    return out;
  }
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    if (!CHAT_ID_RE.test(id)) continue;
    try {
      const sess = readOneSession(id);
      if (!sess) {
        out.skipped += 1;
        continue;
      }
      writeChatSessionMemoryMirror(workspaceDir, sess);
      out.written += 1;
    } catch (err) {
      out.errors += 1;
      console.warn(
        `[chat-memory] backfill write failed for ${id}:`,
        err && err.message ? err.message : err
      );
    }
  }

  try {
    fs.writeFileSync(
      marker,
      `${new Date().toISOString()}\nwritten=${out.written} skipped=${out.skipped} errors=${out.errors}\n`,
      'utf8'
    );
  } catch (err) {
    console.warn('[chat-memory] marker write failed:', err && err.message ? err.message : err);
  }

  if (out.written || out.errors) {
    console.log(
      `[chat-memory] backfill ${workspaceDir}: written=${out.written} skipped=${out.skipped} errors=${out.errors}`
    );
  }
  return out;
}

/**
 * Prompt block appended to Cyrus's system prompt. Teaches the model that
 * `memory/chats/*.md` exists, that it should query-expand then Grep when the
 * user asks something that might have come up before, and how to cite what
 * it recalled (with conversation id + date so the user can audit).
 *
 * Kept intentionally short — it competes with every other system block for
 * Cyrus's attention.
 */
function memoryInstructionsBlock() {
  if (isFeatureDisabled()) return '';
  return [
    '## Cross-chat memory (mandatory when relevant)',
    '',
    'Every dashboard chat in this workspace is mirrored as markdown under',
    '`memory/chats/<conversation-id>.md` (turn-by-turn transcripts, not raw JSON).',
    'Prior `owners-inbox/` deliverables live alongside. You have `Grep`, `Glob`,',
    'and `Read` over all of it — use them before answering anything that might',
    'have come up before.',
    '',
    'When the user asks about a topic, person, decision, number, or event that',
    'sounds like it could have history ("how are we tracking on X", "what did',
    'we decide about Y", "the thing with Z"):',
    '',
    '1. **Expand the query.** Brainstorm 3–7 phrasings the prior chat might have',
    '   used — synonyms, related concepts, likely file-name fragments. Example:',
    '   "cash runway" → `runway`, `cashflow`, `liquidity`, `borrowing capacity`,',
    '   `months of coverage`, `bank balance`.',
    '2. **Grep both corpora.** Run `Grep` against `memory/chats/` and',
    '   `owners-inbox/` for the strongest 2–4 terms (not all of them — pick the',
    '   most discriminating). Prefer fixed-string searches; case-insensitive is',
    '   usually right.',
    '3. **Read top matches selectively.** For each promising hit, `Read` the',
    '   transcript or file with an offset+limit near the match. Do not',
    '   whole-file-read transcripts over ~10 KB.',
    '4. **Cite what you recalled.** In your reply, say *which* past chat or',
    '   file the context came from, with the date. Example: "From a chat on',
    '   2026-04-07 (Ledger on EI income) you decided …". Never present',
    '   recalled context as if it happened in the current session.',
    '5. **Check for staleness.** If the recalled fact is older than a few weeks',
    '   and the user is acting on it now, flag the age and ask if it still',
    '   stands — facts expire; the mirror does not.',
    '',
    'Skip the recall pass entirely for greetings, trivial follow-ups inside the',
    'current chat, or direct DB/file tasks where history is irrelevant. The',
    'goal is a system that feels familiar without dragging in noise.',
  ].join('\n');
}

/**
 * Append the memory-librarian block to a system prompt (no-op when disabled).
 * Use at the end of the prompt pipeline, after tenant `CYRUS.md` and other
 * per-request augmentations, so the freshest rules win.
 *
 * @param {string} basePrompt
 */
function appendMemoryInstructions(basePrompt) {
  const block = memoryInstructionsBlock();
  if (!block) return basePrompt;
  return `${basePrompt}\n\n---\n\n${block}\n`;
}

module.exports = {
  writeChatSessionMemoryMirror,
  deleteChatSessionMemoryMirror,
  backfillChatSessionMemoryMirrors,
  memoryInstructionsBlock,
  appendMemoryInstructions,
  renderSessionToMarkdown,
  memoryChatsDir,
  memoryChatFilePath,
  isFeatureDisabled,
};
