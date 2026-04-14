/**
 * Claude Agent SDK runner (ESM). Loaded via dynamic import from CommonJS server.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { appendAssistantStreamChunk } from './public/shared/stream-chunk.mjs';

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

/** SDK preset subagent ids — not team slugs; emitting segmentAgent would duplicate the UI panel opened from tool detail heuristics. */
const GENERIC_SUBAGENT_SEGMENT_SKIP = new Set([
  'explore',
  'generalpurpose',
  'general_purpose',
  'plan',
  'shell',
  'best_of_n_runner',
  'best-of-n-runner',
]);

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
 * @param {string} opts.dbDir
 * @param {string} [opts.auditLogPath]
 * @param {boolean} [opts.auditTools]
 * @param {number} [opts.maxTurns]
 * @param {AbortSignal} [opts.abortSignal]
 * @param {(chunk: string) => void} opts.onTextChunk
 * @param {(payload: { tool: string, detail: string }) => void} [opts.onTool]
 * @param {(agentId: string) => void} [opts.onSegmentAgent] when a Task / Agent subagent handoff is detected (best-effort from tool_input)
 * @param {(line: string) => void} [opts.onLog]
 * @param {(sessionId: string) => void} [opts.onInitSession]
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

  const auditPath = opts.auditLogPath || path.join(opts.cwd, 'chat-tool-audit.log');
  const shouldAudit = opts.auditTools !== false;
  const hooks = shouldAudit
    ? {
        PostToolUse: [
          {
            hooks: [
              async (input) => {
                try {
                  const tool = input?.tool_name || 'unknown';
                  const line = `${new Date().toISOString()}\t${tool}\t${JSON.stringify(input?.tool_input ?? {}).slice(0, 500)}\n`;
                  fs.appendFileSync(auditPath, line, 'utf8');
                } catch (_) {}
                opts.onLog?.(`[tool] ${input?.tool_name || 'tool'}`);
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
                    if (raw != null && String(raw).trim()) {
                      const slug = String(raw)
                        .trim()
                        .toLowerCase()
                        .replace(/\s+/g, '_')
                        .replace(/-/g, '_');
                      if (!GENERIC_SUBAGENT_SEGMENT_SKIP.has(slug)) {
                        opts.onSegmentAgent(slug);
                      }
                    }
                  }
                } catch (_) {}
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

  if (opts.allowedTools?.length) options.allowedTools = opts.allowedTools;
  if (abortController) options.abortController = abortController;
  if (Object.keys(mcpServers).length) options.mcpServers = mcpServers;
  if (hooks) options.hooks = hooks;
  if (opts.resume) options.resume = opts.resume;
  if (opts.pathToClaudeCodeExecutable) options.pathToClaudeCodeExecutable = opts.pathToClaudeCodeExecutable;

  let assistantBuf = '';
  let sessionIdOut = null;
  let lastResultText = '';
  let hadError = false;
  const errLines = [];
  /** @type {ReturnType<typeof snapshotSdkBillingFromResultMessage>} */
  let sdkBilling = null;

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
          assistantBuf = appendAssistantStreamChunk(assistantBuf, d);
          opts.onTextChunk(d);
        }
      }

      if (msg.type === 'assistant') {
        const label = extractToolLabelFromAssistant(msg.message);
        if (label) opts.onTool?.(label);
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
