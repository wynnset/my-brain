'use strict';

const fs = require('fs');
const express = require('express');
const session = require('../lib/session.js');

function registerOrchestratorRoutes(app, ctx) {
  const { workspaceDirForRequest, orchestrator } = ctx;
  const {
    resolveOrchestratorBriefPath,
    resolveOrchestratorBriefPathInWorkspace,
    orchestratorBriefWritePath,
    orchestratorBriefWritePathForWorkspace,
  } = orchestrator;

  function getOrchestratorBrief(req, res) {
    const ws = workspaceDirForRequest(req);
    const p = session.multiUserMode() ? resolveOrchestratorBriefPathInWorkspace(ws) : resolveOrchestratorBriefPath();
    if (!p) return res.status(404).end();
    res.sendFile(p);
  }

  function putOrchestratorBrief(req, res) {
    const ws = workspaceDirForRequest(req);
    const target = session.multiUserMode() ? orchestratorBriefWritePathForWorkspace(ws) : orchestratorBriefWritePath();
    fs.writeFileSync(target, req.body, 'utf8');
    res.json({ ok: true });
  }

  app.get('/api/cyrus', getOrchestratorBrief);
  app.put('/api/cyrus', express.text({ type: '*/*', limit: '2mb' }), putOrchestratorBrief);
  app.get('/api/larry', getOrchestratorBrief);
  app.put('/api/larry', express.text({ type: '*/*', limit: '2mb' }), putOrchestratorBrief);
}

module.exports = { registerOrchestratorRoutes };
