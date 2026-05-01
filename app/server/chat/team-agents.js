'use strict';

/**
 * Programmatic Claude Agent SDK subagent registration from the tenant's
 * `team/*.md` folder.
 *
 * Each `.md` file in `<workspaceDir>/team/` becomes an `options.agents` entry
 * keyed by the filename (lowercased, no extension). Optional YAML frontmatter
 * at the top of the file may declare:
 *
 *   ---
 *   name: dash                         # override id (default: filename)
 *   description: One-line summary.     # used in the Task tool schema
 *   tools: [Bash, Read, Glob, Grep]    # tool allowlist for this subagent
 *   model: haiku | sonnet | opus       # optional model pin
 *   ---
 *
 * Files without frontmatter still register with sensible defaults. The
 * per-request shared `subagent-operating-rules.md` is appended to each
 * agent's system prompt so platform rules (rate limits, output contract,
 * file-evidence rule) apply uniformly.
 *
 * @module app/server/chat/team-agents
 */

const fs = require('fs');
const path = require('path');

/**
 * Minimal YAML frontmatter parser — handles scalars and bracketed arrays
 * (`tools: [Bash, Read]`) or one-per-line dash lists. Does NOT attempt to
 * be a general YAML implementation; if the tenant needs richer syntax we
 * can swap in `js-yaml` later.
 *
 * @param {string} text
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
function parseFrontmatter(text) {
  const src = String(text || '');
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const body = src.slice(m[0].length);
  /** @type {Record<string, unknown>} */
  const data = {};
  const lines = m[1].split('\n');
  let lastKey = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const listItem = /^\s+-\s+(.+)$/.exec(line);
    if (listItem && lastKey) {
      const cur = data[lastKey];
      const arr = Array.isArray(cur) ? cur : [];
      arr.push(stripQuotes(listItem[1].trim()));
      data[lastKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2].trim();
    lastKey = key;
    if (!rawVal) {
      data[key] = [];
      continue;
    }
    const bracket = /^\[\s*(.*?)\s*\]$/.exec(rawVal);
    if (bracket) {
      data[key] = bracket[1]
        ? bracket[1].split(',').map((s) => stripQuotes(s.trim())).filter(Boolean)
        : [];
      continue;
    }
    data[key] = stripQuotes(rawVal);
  }
  return { data, body };
}

function stripQuotes(s) {
  const v = String(s || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Normalize an agent id to the same slug shape the client uses. */
function agentSlugFromFilename(filename) {
  const base = String(filename || '').replace(/\.md$/i, '').toLowerCase().trim();
  return base.replace(/\s+/g, '_').replace(/-/g, '_');
}

/**
 * Default tool allowlist for subagents whose `team/*.md` did not declare one.
 * Intentionally conservative — if a team member needs Bash or network access
 * they (or the operator) must opt in via frontmatter.
 */
const DEFAULT_SUBAGENT_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];

/**
 * Tools the Agent SDK recognizes. Used to filter out typos / unsupported
 * entries from frontmatter without hard-failing the load.
 */
const KNOWN_TOOL_NAMES = new Set([
  'Bash',
  'BashOutput',
  'Edit',
  'Glob',
  'Grep',
  'KillShell',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'SlashCommand',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
]);

/**
 * Parse a value into a tool list. Accepts comma-separated strings, arrays of
 * strings, and the literal string `readonly`.
 *
 * @param {unknown} raw
 * @returns {string[] | null}
 */
function normalizeDeclaredTools(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    if (t === 'readonly') return ['Read', 'Glob', 'Grep'];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s || '').trim()).filter(Boolean);
  }
  return null;
}

/**
 * Intersect a declared tool list with a global override so operators can
 * tighten (never widen) what any subagent may use via an env var.
 *
 * @param {string[]} declared
 * @param {string[] | null} overrideAllow
 * @returns {string[]}
 */
function filterToolsWithOverride(declared, overrideAllow) {
  const okTools = declared.filter((t) => {
    const n = String(t || '').trim();
    if (!n) return false;
    if (n.startsWith('mcp__')) return true;
    return KNOWN_TOOL_NAMES.has(n);
  });
  if (!overrideAllow || !overrideAllow.length) return okTools;
  const allow = new Set(overrideAllow);
  return okTools.filter((t) => allow.has(t) || t.startsWith('mcp__'));
}

/**
 * Extract a description from file content if frontmatter did not supply one.
 * Prefers a blank-line-separated paragraph under `## Identity` or the first
 * paragraph after the leading H1. Falls back to a generic label.
 *
 * @param {string} body
 * @param {string} slug
 */
function inferDescription(body, slug) {
  const text = String(body || '');
  const idMatch = /##\s+Identity\s*\n([\s\S]{0,1200})/i.exec(text);
  const section = idMatch ? idMatch[1] : text;
  const para = section.split(/\n\s*\n/).find((p) => {
    const t = p.trim();
    if (!t) return false;
    if (t.startsWith('#')) return false;
    if (t.startsWith('|')) return false;
    if (t.startsWith('-') || t.startsWith('*')) return false;
    return t.length >= 10;
  });
  if (para) {
    const one = para.replace(/\s+/g, ' ').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
    return one.length > 240 ? `${one.slice(0, 237)}…` : one;
  }
  return `${slug} — see team/${slug}.md`;
}

/**
 * Load and parse every `team/*.md` file in the given workspace into Agent SDK
 * subagent definitions.
 *
 * @param {object} opts
 * @param {string} opts.workspaceDir     Tenant workspace root.
 * @param {string} opts.subagentRules    Contents of `subagent-operating-rules.md`
 *   to append to every subagent prompt.
 * @param {string} [opts.proprietaryBlock] Optional "Platform confidentiality"
 *   block already present on the orchestrator prompt; applied to subagents
 *   too for consistency.
 * @param {string[]} [opts.globalToolAllow] If set, no subagent may use tools
 *   outside this list (operator override — narrows, never widens).
 * @param {(msg: string) => void} [opts.onWarn]
 * @returns {Record<string, { description: string, prompt: string, tools: string[], model?: string }> | undefined}
 *   `undefined` if the workspace has no readable `team/` folder.
 */
function loadTenantAgentDefinitions(opts) {
  const { workspaceDir, subagentRules, proprietaryBlock, globalToolAllow, onWarn } = opts;
  if (!workspaceDir) return undefined;
  const teamDir = path.join(workspaceDir, 'team');
  let entries;
  try {
    entries = fs.readdirSync(teamDir);
  } catch (_) {
    return undefined;
  }
  const agents = {};
  for (const f of entries) {
    if (!/\.md$/i.test(f)) continue;
    const full = path.join(teamDir, f);
    let raw;
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      // Guard against pathological files (team members shouldn't be huge).
      if (st.size > 256 * 1024) {
        onWarn?.(`[team-agents] skipping ${f}: ${st.size} bytes exceeds 256 KB cap`);
        continue;
      }
      raw = fs.readFileSync(full, 'utf8');
    } catch (err) {
      onWarn?.(`[team-agents] read ${f}: ${err.message}`);
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const slug = data.name
      ? agentSlugFromFilename(String(data.name))
      : agentSlugFromFilename(f);
    if (!slug) continue;
    if (agents[slug]) {
      onWarn?.(`[team-agents] duplicate agent id "${slug}" (from ${f}) — keeping first`);
      continue;
    }
    const declaredTools = normalizeDeclaredTools(data.tools);
    const tools = filterToolsWithOverride(
      declaredTools && declaredTools.length ? declaredTools : DEFAULT_SUBAGENT_TOOLS,
      globalToolAllow || null
    );
    const description =
      (typeof data.description === 'string' && data.description.trim()) ||
      inferDescription(body, slug);
    const parts = [body.trim()];
    if (proprietaryBlock && proprietaryBlock.trim()) {
      parts.push(proprietaryBlock.trim());
    }
    if (subagentRules && subagentRules.trim()) {
      parts.push(subagentRules.trim());
    }
    /** @type {{ description: string, prompt: string, tools: string[], model?: string }} */
    const def = {
      description: description.length > 240 ? `${description.slice(0, 237)}…` : description,
      prompt: parts.join('\n\n---\n\n'),
      tools,
    };
    const modelRaw = typeof data.model === 'string' ? data.model.trim() : '';
    if (modelRaw) def.model = modelRaw;
    agents[slug] = def;
  }
  return Object.keys(agents).length ? agents : undefined;
}

/**
 * Parse `BRAIN_CHAT_SUBAGENT_TOOLS` (comma-separated tool names) into an
 * allowlist. Empty / unset → no override.
 *
 * @param {string | undefined} raw
 * @returns {string[] | null}
 */
function parseGlobalToolAllowEnv(raw) {
  if (!raw || !String(raw).trim()) return null;
  const parts = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : null;
}

const BROWSER_FETCH_MCP_TOOL = 'mcp__brainBrowser__browser_fetch';

/**
 * Adds the headless-browser MCP tool so Task subagents can escalate when
 * simple `WebFetch` fails or when they would otherwise rely on `Bash`+curl
 * (which cannot pass Cloudflare the way Chromium can).
 *
 * Eligible subagents: any whose allowlist includes `WebFetch`, `WebSearch`,
 * or `Bash` (default team members get Bash; specialists like Gauge often have
 * no `WebFetch` in frontmatter and were previously skipped).
 *
 * Skips if `BRAIN_CHAT_SUBAGENT_TOOLS` narrows the allowlist and omits this
 * tool (operators must add `mcp__brainBrowser__browser_fetch` explicitly).
 *
 * @param {Record<string, { tools?: string[] }> | undefined} agentDefs
 * @param {string[] | null} globalToolAllow from {@link parseGlobalToolAllowEnv}
 */
function attachBrowserMcpToTeamAgents(agentDefs, globalToolAllow) {
  if (!agentDefs) return;
  const narrowed = globalToolAllow && globalToolAllow.length;
  if (narrowed && !globalToolAllow.includes(BROWSER_FETCH_MCP_TOOL)) return;
  for (const def of Object.values(agentDefs)) {
    if (!def || !Array.isArray(def.tools)) continue;
    const t = def.tools;
    const mayTouchHttp =
      t.includes('Bash') || t.includes('WebFetch') || t.includes('WebSearch');
    if (!mayTouchHttp) continue;
    if (!t.includes(BROWSER_FETCH_MCP_TOOL)) t.push(BROWSER_FETCH_MCP_TOOL);
  }
}

module.exports = {
  loadTenantAgentDefinitions,
  parseGlobalToolAllowEnv,
  attachBrowserMcpToTeamAgents,
  parseFrontmatter,
  agentSlugFromFilename,
  DEFAULT_SUBAGENT_TOOLS,
};
