'use strict';

/**
 * Server-managed operating rules appended to dashboard chat system prompts.
 *
 * Two files live beside this one:
 *
 *   - `orchestrator-operating-rules.md` — appended to Cyrus's prompt only.
 *   - `subagent-operating-rules.md`     — appended to every team member's
 *     prompt when they run as a `Task` subagent.
 *
 * Content is cached in memory at first read so the hot path adds ~zero cost.
 * Set `BRAIN_CHAT_RELOAD_RULES=1` to skip the cache during local prompt
 * iteration.
 *
 * @module app/server/chat/operating-rules
 */

const fs = require('fs');
const path = require('path');

const ORCHESTRATOR_RULES_FILE = path.join(__dirname, 'orchestrator-operating-rules.md');
const SUBAGENT_RULES_FILE = path.join(__dirname, 'subagent-operating-rules.md');

/** @type {{ path: string, mtimeMs: number, text: string } | null} */
let orchestratorCache = null;
/** @type {{ path: string, mtimeMs: number, text: string } | null} */
let subagentCache = null;

function shouldBypassCache() {
  return process.env.BRAIN_CHAT_RELOAD_RULES === '1';
}

/**
 * @param {string} filePath
 * @param {{ path: string, mtimeMs: number, text: string } | null} cache
 * @returns {{ cache: { path: string, mtimeMs: number, text: string }, text: string }}
 */
function readWithCache(filePath, cache) {
  if (cache && cache.path === filePath && !shouldBypassCache()) {
    return { cache, text: cache.text };
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    const empty = { path: filePath, mtimeMs: 0, text: '' };
    return { cache: empty, text: '' };
  }
  if (!shouldBypassCache() && cache && cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return { cache, text: cache.text };
  }
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[operating-rules] read ${path.basename(filePath)}: ${err.message}`);
  }
  const next = { path: filePath, mtimeMs: stat.mtimeMs, text };
  return { cache: next, text };
}

/** Full contents of the orchestrator operating-rules markdown (empty string if missing). */
function readOrchestratorOperatingRules() {
  const r = readWithCache(ORCHESTRATOR_RULES_FILE, orchestratorCache);
  orchestratorCache = r.cache;
  return r.text;
}

/** Full contents of the subagent operating-rules markdown (empty string if missing). */
function readSubagentOperatingRules() {
  const r = readWithCache(SUBAGENT_RULES_FILE, subagentCache);
  subagentCache = r.cache;
  return r.text;
}

/**
 * Append the orchestrator operating-rules block to a base Cyrus system prompt.
 * Caller decides where in the prompt pipeline to apply it (typically last,
 * after tenant CYRUS.md and other per-request augmentations).
 *
 * @param {string} basePrompt
 */
function appendOrchestratorOperatingRules(basePrompt) {
  const rules = readOrchestratorOperatingRules();
  if (!rules.trim()) return basePrompt;
  return `${basePrompt}\n\n---\n\n${rules.trim()}\n`;
}

module.exports = {
  readOrchestratorOperatingRules,
  readSubagentOperatingRules,
  appendOrchestratorOperatingRules,
  ORCHESTRATOR_RULES_FILE,
  SUBAGENT_RULES_FILE,
};
