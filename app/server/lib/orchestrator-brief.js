'use strict';

const path = require('path');
const fs = require('fs');

const ORCH_BRIEF_FILE = 'CYRUS.md';
const ORCH_BRIEF_LEGACY = 'LARRY.md';

/**
 * @param {string} dataDir DATA_DIR
 * @param {string} repoRootDir parent of app/
 */
function createOrchestratorBrief(dataDir, repoRootDir) {
  function orchestratorBriefRoots() {
    const roots = [dataDir, repoRootDir];
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
    return path.join(dataDir, ORCH_BRIEF_FILE);
  }

  /** Orchestrator brief only under tenant workspace (multi-user); no repo-root fallback. */
  function resolveOrchestratorBriefPathInWorkspace(workspaceDir) {
    for (const file of [ORCH_BRIEF_FILE, ORCH_BRIEF_LEGACY]) {
      const c = path.join(workspaceDir, file);
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  function orchestratorBriefWritePathForWorkspace(workspaceDir) {
    const found = resolveOrchestratorBriefPathInWorkspace(workspaceDir);
    if (found) return found;
    return path.join(workspaceDir, ORCH_BRIEF_FILE);
  }

  function isOrchestratorChatAgent(agent) {
    const a = String(agent || '').toLowerCase();
    return a === 'cyrus' || a === 'larry';
  }

  return {
    ORCH_BRIEF_FILE,
    ORCH_BRIEF_LEGACY,
    ensureOrchestratorBriefMigrated,
    resolveOrchestratorBriefPath,
    orchestratorBriefWritePath,
    resolveOrchestratorBriefPathInWorkspace,
    orchestratorBriefWritePathForWorkspace,
    isOrchestratorChatAgent,
  };
}

module.exports = { createOrchestratorBrief, ORCH_BRIEF_FILE, ORCH_BRIEF_LEGACY };
