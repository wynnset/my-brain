/**
 * Claude Agent SDK runner (ESM). Loaded via dynamic import from CommonJS server.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  appendAssistantStreamChunk,
  isGenericSdkSubagentId,
  normalizeSubagentIdSlug,
} from './public/shared/stream-chunk.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function extractStreamTextDelta(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    return event.delta.text || '';
  }
  return '';
}

function isDelegationToolName(name) {
  const n = String(name || '').trim().toLowerCase();
  return n === 'task' || n === 'agent';
}

/**
 * Serializable billing snapshot from an Agent SDK `result` message.
 * @param {unknown} msg
 * @returns {{ totalCostUsd: number | null, usage: Record<string, number> | null, modelUsage: Record<string, Record<string, number>> | null, numTurns?: number, resultSubtype?: string } | null}
 */
function snapshotSdkBillingFromResultMessage(msg) {
  if (!msg || typeof msg !== 'object' || msg.type !== 'result') return null;
  const hasCost = typeof msg.total_cost_usd === 'number' && Number.isFinite(msg.total_cost_usd);
  const hasUsage = msg.usage && typeof msg.usage === 'object';
  const hasModelUsage =
    msg.modelUsage && typeof msg.modelUsage === 'object' && Object.keys(msg.modelUsage).length > 0;
  if (!hasCost && !hasUsage && !hasModelUsage) return null;
  let usage = null;
  if (hasUsage) {
    usage = {};
    for (const [k, v] of Object.entries(msg.usage)) {
      if (typeof v === 'number' && Number.isFinite(v)) usage[k] = v;
    }
    if (Object.keys(usage).length === 0) usage = null;
  }
  let modelUsage = null;
  if (hasModelUsage) {
    modelUsage = {};
    for (const [model, mu] of Object.entries(msg.modelUsage)) {
      if (!mu || typeof mu !== 'object') continue;
      const row = {};
      for (const [k, v] of Object.entries(mu)) {
        if (typeof v === 'number' && Number.isFinite(v)) row[k] = v;
      }
      if (Object.keys(row).length) modelUsage[model] = row;
    }
    if (Object.keys(modelUsage).length === 0) modelUsage = null;
  }
  return {
    totalCostUsd: hasCost ? msg.total_cost_usd : null,
    usage,
    modelUsage,
    numTurns: typeof msg.num_turns === 'number' ? msg.num_turns : undefined,
    resultSubtype: typeof msg.subtype === 'string' ? msg.subtype : undefined,
  };
}

function extractToolLabelFromAssistant(message) {
  const content = message?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block?.type === 'tool_use' && block.name) {
      const inp = block.input && typeof block.input === 'object' ? block.input : {};
      const fp = inp.file_path || inp.path || inp.command || inp.pattern || '';
      const deleg = isDelegationToolName(block.name);
      const detail = fp
        ? String(fp).slice(0, 200)
        : JSON.stringify(inp).slice(0, deleg ? 2400 : 160);
      return { tool: block.name, detail };
    }
  }
  return null;
}

/**
 * Collect every delegation `tool_use` block in an assistant message (may be
 * more than one when the model fires parallel `Task` calls in the same turn).
 * Returns `{ id, agent }` pairs with normalized agent slugs; filters out
 * generic SDK presets (general-purpose, explore, …) so the UI only shows
 * lifecycle for real team members.
 *
 * @param {unknown} message
 * @returns {{ id: string, agent: string }[]}
 */
function extractDelegationStartsFromAssistant(message) {
  const out = [];
  const content = message && typeof message === 'object' ? message.content : null;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (!block || block.type !== 'tool_use' || !block.name) continue;
    if (!isDelegationToolName(block.name)) continue;
    const inp = block.input && typeof block.input === 'object' ? block.input : {};
    const raw =
      inp.subagent_type ??
      inp.subagentType ??
      inp.agent ??
      inp.agent_id ??
      inp.agentId;
    const slug = normalizeSubagentIdSlug(raw);
    if (!slug) continue;
    if (isGenericSdkSubagentId(slug)) continue;
    const id = typeof block.id === 'string' ? block.id : '';
    out.push({ id, agent: slug });
  }
  return out;
}

/**
 * Collect every `tool_result` block in a user message — these arrive when a
 * `Task` subagent (or any tool) finishes. We pair them with the `tool_use_id`
 * we recorded when the Task started to emit matching segment-end events.
 *
 * @param {unknown} message
 * @returns {{ id: string, ok: boolean }[]}
 */
function extractToolResultsFromUser(message) {
  const out = [];
  const content = message && typeof message === 'object' ? message.content : null;
  if (!Array.isArray(content)) return out;
  for (const block of content) {
    if (!block || block.type !== 'tool_result') continue;
    const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
    if (!id) continue;
    const ok = block.is_error !== true;
    out.push({ id, ok });
  }
  return out;
}

/** @param {string} spec @returns {string[] | { type: 'preset', preset: 'claude_code' }} */
export function parseToolsOption(spec) {
  const s = String(spec || '').trim().toLowerCase();
  if (!s || s === 'preset' || s === 'claude_code') {
    return { type: 'preset', preset: 'claude_code' };
  }
  if (s === 'readonly') {
    return ['Read', 'Glob', 'Grep'];
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

/** @param {string} spec */
export function parsePermissionOptions(spec) {
  const mode = String(spec || 'bypassPermissions').trim();
  const allowed = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']);
  const permissionMode = allowed.has(mode) ? mode : 'bypassPermissions';
  const allowDangerouslySkipPermissions = permissionMode === 'bypassPermissions';
  return { permissionMode, allowDangerouslySkipPermissions };
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.systemPrompt
 * @param {string} [opts.resume]
 * @param {string} opts.cwd
 * @param {Record<string, string | undefined>} opts.env
 * @param {string[] | { type: 'preset', preset: 'claude_code' }} opts.tools
 * @param {string[]|undefined} opts.allowedTools
 * @param {string} opts.permissionMode
 * @param {boolean} opts.allowDangerouslySkipPermissions
 * @param {boolean} opts.enableMcpBrainDb
 * @param {boolean} [opts.enableMcpBrowserFetch] enables `brain_fetch` MCP (plain HTTP + auto-escalating headless Chromium when Playwright is installed)
 * @param {string} opts.dbDir
 * @param {string} [opts.auditLogPath]
 * @param {boolean} [opts.auditTools]
 * @param {number} [opts.maxTurns]
 * @param {string} [opts.model] Claude model id or alias (e.g. sonnet, claude-sonnet-4-6)
 * @param {AbortSignal} [opts.abortSignal]
 * @param {(chunk: string) => void} opts.onTextChunk
 * @param {(payload: { tool: string, detail: string }) => void} [opts.onTool]
 * @param {(agentId: string) => void} [opts.onSegmentAgent] when a Task / Agent subagent handoff is detected (best-effort from tool_input). Legacy single-active-agent signal kept for back-compat; prefer `onSegmentAgentStart`/`onSegmentAgentEnd` for parallel-aware UIs.
 * @param {(evt: { id: string, agent: string }) => void} [opts.onSegmentAgentStart] fires once per `Task` tool_use block (fires multiple times in the same turn when the model launches parallel subagents).
 * @param {(evt: { id: string, agent: string, ok: boolean }) => void} [opts.onSegmentAgentEnd] fires when the matching `tool_result` arrives for a previously-started delegation.
 * @param {Record<string, { description?: string, prompt: string, tools?: string[], model?: string }>} [opts.agentDefinitions] Programmatic subagent registry mapped to `options.agents`. Enables named team members (dash, ledger, …) as `Task(subagent_type="<slug>")` targets.
 * @param {(line: string) => void} [opts.onLog]
 * @param {(sessionId: string) => void} [opts.onInitSession]
 * @param {(evt: { toolName: string, toolInput: unknown }) => void} [opts.onPostToolUse] runs after each tool invocation (even when file audit logging is disabled)
 * @returns {Promise<{ finalText: string, sessionId: string | null, hadError: boolean, errors: string[], sdkBilling: ReturnType<typeof snapshotSdkBillingFromResultMessage> }>}
 */
export async function runAgentSdkQuery(opts) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const mcpServers = {};
  if (opts.enableMcpBrainDb) {
    const script = path.join(__dirname, 'mcp-brain-db.mjs');
    mcpServers.brainDb = {
      type: 'stdio',
      command: process.execPath,
      args: [script],
      env: {
        ...process.env,
        BRAIN_MCP_DB_DIR: opts.dbDir,
      },
    };
  }
  if (opts.enableMcpBrowserFetch) {
    // brain_fetch can run plain-HTTP fetches without Playwright; the Chromium
    // escalation path is what needs it. We register the server unconditionally
    // and let individual fetches fail-soft if browser-mode is unavailable.
    let playwrightOk = true;
    try {
      await import('playwright');
    } catch (e) {
      playwrightOk = false;
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      opts.onLog?.(`[chat-sdk] brain_fetch: Chromium escalation disabled, playwright not available (${msg})`);
    }
    // JSONL telemetry alongside chat-tool-audit.log when auditing is enabled.
    // Tracks per-call: cache hit, http vs browser path, escalation reason,
    // output chars, duration. Disabled when BRAIN_CHAT_AUDIT_TOOLS=0.
    const auditPathForFetch = opts.auditLogPath || path.join(opts.cwd, 'chat-tool-audit.log');
    const fetchLogPath =
      opts.auditTools !== false ? path.join(path.dirname(auditPathForFetch), 'brain-fetch.log') : '';
    const script = path.join(__dirname, 'mcp-brain-fetch.mjs');
    let scriptOk = true;
    try {
      fs.statSync(script);
    } catch (_) {
      scriptOk = false;
    }
    if (!scriptOk) {
      const msg = `[chat-sdk] brainFetch MCP NOT registered — script missing at ${script}`;
      console.warn(msg);
      opts.onLog?.(msg);
    } else {
      mcpServers.brainFetch = {
        type: 'stdio',
        command: process.execPath,
        args: [script],
        env: {
          ...process.env,
          BRAIN_FETCH_PLAYWRIGHT_OK: playwrightOk ? '1' : '0',
          BRAIN_FETCH_LOG_PATH: fetchLogPath,
        },
      };
      const msg = `[chat-sdk] brainFetch MCP registered (script=${script}, playwright=${playwrightOk ? 'on' : 'off'}, log=${fetchLogPath || '(disabled)'})`;
      console.log(msg);
      opts.onLog?.(msg);
    }
  } else {
    const msg = '[chat-sdk] brainFetch MCP NOT registered (enableMcpBrowserFetch=false; set BRAIN_CHAT_MCP_BROWSER=1 to enable)';
    console.log(msg);
    opts.onLog?.(msg);
  }

  const auditPath = opts.auditLogPath || path.join(opts.cwd, 'chat-tool-audit.log');
  const shouldAudit = opts.auditTools !== false;
  const postToolCb = typeof opts.onPostToolUse === 'function' ? opts.onPostToolUse : null;
  const hooks =
    shouldAudit || postToolCb
      ? {
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  if (shouldAudit) {
                    try {
                      const tool = input?.tool_name || 'unknown';
                      const line = `${new Date().toISOString()}\t${tool}\t${JSON.stringify(input?.tool_input ?? {}).slice(0, 500)}\n`;
                      fs.appendFileSync(auditPath, line, 'utf8');
                    } catch (_) {}
                    opts.onLog?.(`[tool] ${input?.tool_name || 'tool'}`);
                  }
                  try {
                    const name = input?.tool_name;
                    const ti = input?.tool_input;
                    if (isDelegationToolName(name) && ti && typeof ti === 'object' && opts.onSegmentAgent) {
                      const raw =
                        ti.subagent_type ??
                        ti.subagentType ??
                        ti.agent ??
                        ti.agent_id ??
                        ti.agentId;
                      const slug = normalizeSubagentIdSlug(raw);
                      if (slug && !isGenericSdkSubagentId(slug)) {
                        opts.onSegmentAgent(slug);
                      }
                    }
                  } catch (_) {}
                  if (postToolCb) {
                    try {
                      postToolCb({ toolName: input?.tool_name || '', toolInput: input?.tool_input });
                    } catch (_) {}
                  }
                  return {};
                },
              ],
            },
          ],
        }
      : undefined;

  let abortController;
  if (opts.abortSignal) {
    abortController = new AbortController();
    const onAbort = () => abortController.abort();
    if (opts.abortSignal.aborted) onAbort();
    else opts.abortSignal.addEventListener('abort', onAbort, { once: true });
  }

  /** @type {import('@anthropic-ai/claude-agent-sdk').Options} */
  const options = {
    cwd: opts.cwd,
    env: opts.env,
    systemPrompt: opts.systemPrompt,
    tools: opts.tools,
    permissionMode: opts.permissionMode,
    allowDangerouslySkipPermissions: opts.allowDangerouslySkipPermissions,
    includePartialMessages: true,
    maxTurns: opts.maxTurns ?? 100,
  };

  // BRAIN_CHAT_DEBUG_SDK=1 pipes the Claude Code CLI subprocess's stderr
  // through opts.onLog. Useful for diagnosing why an MCP server isn't
  // appearing in the model's tool list (the SDK otherwise discards CLI
  // stderr unless DEBUG_CLAUDE_AGENT_SDK is set).
  if (process.env.BRAIN_CHAT_DEBUG_SDK === '1') {
    options.stderr = (line) => {
      const msg = `[claude-cli] ${String(line).replace(/\s+$/, '')}`;
      console.warn(msg);
      opts.onLog?.(msg);
    };
  }

  if (opts.allowedTools?.length) options.allowedTools = opts.allowedTools;
  if (abortController) options.abortController = abortController;
  if (Object.keys(mcpServers).length) options.mcpServers = mcpServers;
  if (hooks) options.hooks = hooks;
  if (opts.resume) options.resume = opts.resume;
  if (opts.pathToClaudeCodeExecutable) options.pathToClaudeCodeExecutable = opts.pathToClaudeCodeExecutable;
  if (opts.model && String(opts.model).trim()) options.model = String(opts.model).trim();
  if (opts.agentDefinitions && typeof opts.agentDefinitions === 'object' && Object.keys(opts.agentDefinitions).length) {
    options.agents = opts.agentDefinitions;
    if (process.env.BRAIN_CHAT_DEBUG_AGENTS === '1' || !opts.resume) {
      try {
        const slugs = Object.keys(opts.agentDefinitions).sort();
        opts.onLog?.(`[chat-sdk] agents registered: ${slugs.join(', ')}`);
        // Best-effort console visibility so operators can confirm registration
        // without opting into full debug logging.
        console.log(`[chat-sdk] agents registered (${slugs.length}): ${slugs.join(', ')}`);
      } catch (_) {}
    }
  } else if (process.env.BRAIN_CHAT_DEBUG_AGENTS === '1') {
    console.log('[chat-sdk] no agentDefinitions provided to runner');
  }

  let assistantBuf = '';
  let sessionIdOut = null;
  let lastResultText = '';
  let hadError = false;
  const errLines = [];
  /** @type {ReturnType<typeof snapshotSdkBillingFromResultMessage>} */
  let sdkBilling = null;
  /** Open delegations: `tool_use_id` → agent slug. Cleared as `tool_result` blocks arrive. */
  const openDelegations = new Map();
  /**
   * When the model pauses to call a tool (or hand off to a subagent) we set this flag so that
   * the next streamed text chunk starts on a new paragraph instead of gluing onto the prior
   * sentence (e.g. "Let me pull this now.Ok, here's what I found" → proper paragraph break).
   */
  let pendingParagraphBreak = false;

  const q = query({ prompt: opts.prompt, options });

  try {
    for await (const msg of q) {
      if (opts.abortSignal?.aborted) {
        try {
          q.close();
        } catch (_) {}
        break;
      }

      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionIdOut = msg.session_id;
        opts.onInitSession?.(msg.session_id);
      }

      if (msg.type === 'stream_event') {
        const d = extractStreamTextDelta(msg.event);
        if (d) {
          let chunk = d;
          if (pendingParagraphBreak && assistantBuf && !/\n\n$/.test(assistantBuf)) {
            const prefix = assistantBuf.endsWith('\n') ? '\n' : '\n\n';
            chunk = prefix + d;
          }
          pendingParagraphBreak = false;
          assistantBuf = appendAssistantStreamChunk(assistantBuf, chunk);
          opts.onTextChunk(chunk);
        }
      }

      if (msg.type === 'assistant') {
        const label = extractToolLabelFromAssistant(msg.message);
        if (label) {
          opts.onTool?.(label);
          if (assistantBuf) pendingParagraphBreak = true;
        }
        const starts = extractDelegationStartsFromAssistant(msg.message);
        for (const s of starts) {
          if (s.id) openDelegations.set(s.id, s.agent);
          try {
            opts.onSegmentAgentStart?.({ id: s.id, agent: s.agent });
          } catch (_) {}
        }
      }

      if (msg.type === 'user') {
        const results = extractToolResultsFromUser(msg.message);
        for (const r of results) {
          const agent = openDelegations.get(r.id);
          if (!agent) continue;
          openDelegations.delete(r.id);
          try {
            opts.onSegmentAgentEnd?.({ id: r.id, agent, ok: r.ok });
          } catch (_) {}
        }
      }

      if (msg.type === 'tool_progress') {
        opts.onTool?.({
          tool: msg.tool_name || 'tool',
          detail: `${msg.elapsed_time_seconds || 0}s`,
        });
      }

      if (msg.type === 'result') {
        sessionIdOut = msg.session_id || sessionIdOut;
        const snap = snapshotSdkBillingFromResultMessage(msg);
        if (snap) sdkBilling = snap;
        if (msg.subtype === 'success' && typeof msg.result === 'string') {
          lastResultText = msg.result;
        } else {
          hadError = true;
          const errs = msg.errors || [];
          errLines.push(...errs.map(String));
        }
      }
    }
  } finally {
    try {
      q.close();
    } catch (_) {}
    // Flush any delegations that never saw a matching tool_result (abort,
    // fatal error, or a subagent that was silently dropped). The UI should
    // stop showing them as "working" regardless.
    for (const [id, agent] of openDelegations) {
      try {
        opts.onSegmentAgentEnd?.({ id, agent, ok: false });
      } catch (_) {}
    }
    openDelegations.clear();
  }

  const finalText = lastResultText || assistantBuf;
  return {
    finalText,
    sessionId: sessionIdOut,
    hadError,
    errors: errLines,
    sdkBilling,
  };
}
