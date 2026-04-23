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
  function migrationRoots() {
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

  /** Rename any legacy LARRY.md left at repo root to CYRUS.md (harmless no-op once clean). */
  function ensureOrchestratorBriefMigrated() {
    for (const root of migrationRoots()) {
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

  /** Orchestrator brief only under tenant workspace; no repo-root fallback. */
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
    resolveOrchestratorBriefPathInWorkspace,
    orchestratorBriefWritePathForWorkspace,
    isOrchestratorChatAgent,
  };
}

module.exports = { createOrchestratorBrief, ORCH_BRIEF_FILE, ORCH_BRIEF_LEGACY };
