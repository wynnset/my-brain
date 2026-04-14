'use strict';

const { registerCoreRoutes } = require('./core.js');
const { registerDbApiRoutes } = require('./db-api.js');
const registerChatRoutes = require('./chat.js');
const { registerFileRoutes } = require('./files.js');
const { registerOrchestratorRoutes } = require('./orchestrator.js');
const { registerDashboardRoutes } = require('./dashboard.js');
const { registerDomainRoutes } = require('./domain.js');

/** Health + auth endpoints (before session gate). */
function registerPublicRoutes(app, ctx) {
  registerCoreRoutes(app, ctx);
}

/** All routes that require dashboard session (or API token where applicable). */
function registerProtectedRoutes(app, ctx) {
  registerDbApiRoutes(app, ctx);
  registerChatRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  registerOrchestratorRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);
  registerDomainRoutes(app, ctx);
}

module.exports = { registerPublicRoutes, registerProtectedRoutes };
