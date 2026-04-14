'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { safeJoin } = require('../tenancy/tenancy-utils.js');
const session = require('../lib/session.js');

const FILES_META_FILE = '.files-meta.json';
const META_STRING_MAX = 240;

function safeBrowseFileName(name) {
  if (!name || typeof name !== 'string') return null;
  const base = path.basename(name.trim());
  if (!base || base !== name.trim() || base.includes('..') || base.includes('/') || base.includes('\\'))
    return null;
  return base;
}

function sanitizeMetaString(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > META_STRING_MAX ? s.slice(0, META_STRING_MAX) : s;
}

function readFilesMetaMap(dirPath) {
  const p = path.join(dirPath, FILES_META_FILE);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
}

function writeFilesMetaMap(dirPath, map) {
  fs.writeFileSync(path.join(dirPath, FILES_META_FILE), JSON.stringify(map, null, 2), 'utf8');
}

function metaFieldsForFile(map, fileName) {
  const m = map[fileName] || {};
  return {
    createdBy: typeof m.createdBy === 'string' ? m.createdBy : '',
    domain: typeof m.domain === 'string' ? m.domain : '',
    category: typeof m.category === 'string' ? m.category : '',
  };
}

function attachMetaToEntries(dirPath, entries) {
  const map = readFilesMetaMap(dirPath);
  return entries.map((e) => {
    const x = metaFieldsForFile(map, e.name);
    return { ...e, createdBy: x.createdBy, domain: x.domain, category: x.category };
  });
}

/** Tags (createdBy / domain / category), PATCH meta, and archive only apply under these folders. */
const FILES_META_DIRS = new Set(['owners-inbox', 'team-inbox', 'docs']);

function entriesWithoutMeta(entries) {
  return entries.map((e) => ({
    ...e,
    createdBy: '',
    domain: '',
    category: '',
  }));
}

const UPLOAD_FILENAME_AGENT_IDS = new Set([
  'dash', 'scout', 'gauge', 'ledger', 'charter', 'arc', 'tailor', 'debrief',
  'relay', 'sylvan', 'mirror', 'vesta', 'dara', 'frame', 'vela', 'cyrus',
]);

function inferAgentIdFromUploadFilename(filename) {
  const base = path.basename(String(filename || '')).toLowerCase();
  const m = base.match(/^([a-z][a-z0-9]*)[-_.]/);
  if (!m) return '';
  const id = m[1];
  return UPLOAD_FILENAME_AGENT_IDS.has(id) ? id : '';
}

function defaultUploadDomainForAgent(agentId, pages) {
  const p = pages || { career: true, finance: true, business: true };
  const a = String(agentId || '').toLowerCase();
  if (a === 'ledger') return p.finance ? 'finance' : 'personal';
  if (a === 'charter') return p.business ? 'business' : 'personal';
  if (a === 'owner') return 'personal';
  return p.career ? 'career' : 'personal';
}

/** Resolves createdBy + domain for team-inbox uploads (multipart body and/or headers, then filename). */
function buildTeamInboxUploadMeta(filename, body, getHeader, pages) {
  const b = body && typeof body === 'object' ? body : {};
  let createdBy = sanitizeMetaString(b.createdBy) || sanitizeMetaString(getHeader('x-created-by'));
  let domain = sanitizeMetaString(b.domain) || sanitizeMetaString(getHeader('x-file-domain'));
  let category = sanitizeMetaString(b.category) || sanitizeMetaString(getHeader('x-file-category'));
  if (!createdBy) createdBy = inferAgentIdFromUploadFilename(filename);
  if (!createdBy) createdBy = 'cyrus';
  if (!domain) domain = defaultUploadDomainForAgent(createdBy, pages);
  const out = { createdBy, domain };
  if (category) out.category = category;
  return out;
}

const BROWSABLE = ['owners-inbox', 'team-inbox', 'team', 'docs'];
const EDITABLE_EXTS = ['.md', '.html', '.txt', '.json'];

function registerFileRoutes(app, ctx) {
  const {
    workspaceDirForRequest,
    dashboardPagesForRequest,
    orchestrator,
  } = ctx;
  const {
    ORCH_BRIEF_FILE,
    ORCH_BRIEF_LEGACY,
    resolveOrchestratorBriefPath,
    resolveOrchestratorBriefPathInWorkspace,
  } = orchestrator;

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        try {
          const ws = workspaceDirForRequest(req);
          const dir = safeJoin(ws, 'team-inbox');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (err) {
          cb(err);
        }
      },
      filename: (req, file, cb) => cb(null, file.originalname),
    }),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  function resolveBrowseLocation(req, dir, name) {
    const base = safeBrowseFileName(name);
    if (!base) return null;
    const ws = workspaceDirForRequest(req);
    if (dir === 'root') {
      const brief = session.multiUserMode()
        ? resolveOrchestratorBriefPathInWorkspace(ws)
        : resolveOrchestratorBriefPath();
      if (!brief) return null;
      const onDisk = path.basename(brief);
      if (base !== onDisk && base !== ORCH_BRIEF_FILE && base !== ORCH_BRIEF_LEGACY) return null;
      return { dirPath: path.dirname(brief), fileName: onDisk, fullPath: brief };
    }
    if (!BROWSABLE.includes(dir)) return null;
    const dirPath = safeJoin(ws, dir);
    const fullPath = safeJoin(dirPath, base);
    return { dirPath, fileName: base, fullPath };
  }

  function listVisibleFilesInDir(dirPath) {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter((name) => !name.startsWith('.') && !name.startsWith('_archived_'))
      .map((name) => {
        const stat = fs.statSync(path.join(dirPath, name));
        if (!stat.isFile()) return null;
        return { name, size: stat.size, modified: stat.mtime };
      })
      .filter(Boolean)
      .sort((a, b) => b.modified - a.modified);
  }

  app.post('/api/upload', upload.array('files'), (req, res) => {
    if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
    const teamInboxPath = safeJoin(workspaceDirForRequest(req), 'team-inbox');
    const body = req.body || {};
    const getHeader = (name) => req.get(name);
    const uploadPages = dashboardPagesForRequest(req);
    const map = readFilesMetaMap(teamInboxPath);
    for (const f of req.files) {
      const key = f.filename;
      if (!safeBrowseFileName(key)) continue;
      const built = buildTeamInboxUploadMeta(key, body, getHeader, uploadPages);
      const prev = metaFieldsForFile(map, key);
      const merged = { ...prev, ...built };
      const next = {};
      if (merged.createdBy) next.createdBy = merged.createdBy;
      if (merged.domain) next.domain = merged.domain;
      if (merged.category) next.category = merged.category;
      map[key] = next;
    }
    writeFilesMetaMap(teamInboxPath, map);
    res.json({ uploaded: req.files.map(f => ({ name: f.originalname, size: f.size })) });
  });

  app.get('/api/files', (req, res) => {
    const ws = workspaceDirForRequest(req);
    const result = {};
    for (const dir of BROWSABLE) {
      const dirPath = safeJoin(ws, dir);
      const listed = listVisibleFilesInDir(dirPath);
      result[dir] = FILES_META_DIRS.has(dir) ? attachMetaToEntries(dirPath, listed) : entriesWithoutMeta(listed);
    }
    const briefPath = session.multiUserMode() ? resolveOrchestratorBriefPathInWorkspace(ws) : resolveOrchestratorBriefPath();
    if (briefPath) {
      const stat = fs.statSync(briefPath);
      const rootName = path.basename(briefPath);
      result['root'] = entriesWithoutMeta([{ name: rootName, size: stat.size, modified: stat.mtime }]);
    }
    res.json(result);
  });

  app.patch('/api/files/:dir/:name/meta', (req, res) => {
    if (!FILES_META_DIRS.has(req.params.dir))
      return res.status(403).json({ error: 'Metadata is only available for docs, owners-inbox, and team-inbox' });
    const loc = resolveBrowseLocation(req, req.params.dir, req.params.name);
    if (!loc) return res.status(400).json({ error: 'Invalid path' });
    try {
      if (!fs.existsSync(loc.fullPath) || !fs.statSync(loc.fullPath).isFile())
        return res.status(404).json({ error: 'Not found' });
    } catch (_) {
      return res.status(404).json({ error: 'Not found' });
    }
    const body = req.body || {};
    const map = readFilesMetaMap(loc.dirPath);
    const cur = { ...metaFieldsForFile(map, loc.fileName) };
    if ('createdBy' in body) cur.createdBy = sanitizeMetaString(body.createdBy);
    if ('domain' in body) cur.domain = sanitizeMetaString(body.domain);
    if ('category' in body) cur.category = sanitizeMetaString(body.category);
    const next = {};
    if (cur.createdBy) next.createdBy = cur.createdBy;
    if (cur.domain) next.domain = cur.domain;
    if (cur.category) next.category = cur.category;
    if (Object.keys(next).length) map[loc.fileName] = next;
    else delete map[loc.fileName];
    writeFilesMetaMap(loc.dirPath, map);
    res.json({ ok: true, meta: metaFieldsForFile(map, loc.fileName) });
  });

  app.post('/api/files/:dir/:name/archive', (req, res) => {
    if (!FILES_META_DIRS.has(req.params.dir))
      return res.status(403).json({ error: 'Archive is only available for docs, owners-inbox, and team-inbox' });
    const loc = resolveBrowseLocation(req, req.params.dir, req.params.name);
    if (!loc) return res.status(400).json({ error: 'Invalid path' });
    const { name } = req.params;
    if (name.startsWith('_archived_'))
      return res.status(400).json({ error: 'Already archived' });
    try {
      if (!fs.existsSync(loc.fullPath) || !fs.statSync(loc.fullPath).isFile())
        return res.status(404).json({ error: 'Not found' });
    } catch (_) {
      return res.status(404).json({ error: 'Not found' });
    }
    const newName = `_archived_${name}`;
    const newPath = path.join(loc.dirPath, newName);
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Archive name already exists' });
    fs.renameSync(loc.fullPath, newPath);
    const map = readFilesMetaMap(loc.dirPath);
    if (map[name]) {
      map[newName] = map[name];
      delete map[name];
    }
    writeFilesMetaMap(loc.dirPath, map);
    res.json({ ok: true, archivedAs: newName });
  });

  app.get('/api/files/:dir/:name', (req, res) => {
    const { dir, name } = req.params;
    if (!BROWSABLE.includes(dir)) return res.status(403).end();
    let filePath;
    try {
      filePath = safeJoin(workspaceDirForRequest(req), dir, name);
    } catch (_) {
      return res.status(400).end();
    }
    if (!fs.existsSync(filePath)) return res.status(404).end();
    try {
      if (!fs.statSync(filePath).isFile()) return res.status(404).end();
    } catch (_) {
      return res.status(404).end();
    }
    res.sendFile(filePath);
  });

  app.put('/api/files/:dir/:name', express.text({ type: '*/*', limit: '2mb' }), (req, res) => {
    const { dir, name } = req.params;
    if (!BROWSABLE.includes(dir)) return res.status(403).end();
    if (!EDITABLE_EXTS.includes(path.extname(name)))
      return res.status(403).json({ error: 'File type not editable' });
    let putPath;
    try {
      putPath = safeJoin(workspaceDirForRequest(req), dir, name);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    try {
      if (fs.existsSync(putPath) && !fs.statSync(putPath).isFile())
        return res.status(403).json({ error: 'Not a file' });
    } catch (_) {}
    fs.writeFileSync(putPath, req.body, 'utf8');
    res.json({ ok: true });
  });
}

module.exports = { registerFileRoutes };
