'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const registryDb = require('../tenancy/registry-db.js');

// In-memory auth codes: code → { userId, redirectUri, expiresAt, codeChallenge, codeChallengeMethod }
const pendingCodes = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;

function cleanExpiredCodes() {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt <= now) pendingCodes.delete(code);
  }
}

function isValidRedirectUri(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch (_) {
    return false;
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function authorizeHtml({ redirectUri, state, clientId, codeChallenge, codeChallengeMethod, error }) {
  const hidden = [
    `<input type="hidden" name="redirect_uri" value="${esc(redirectUri)}">`,
    `<input type="hidden" name="state" value="${esc(state || '')}">`,
    `<input type="hidden" name="client_id" value="${esc(clientId || '')}">`,
    codeChallenge ? `<input type="hidden" name="code_challenge" value="${esc(codeChallenge)}">` : '',
    codeChallengeMethod ? `<input type="hidden" name="code_challenge_method" value="${esc(codeChallengeMethod)}">` : '',
  ].filter(Boolean).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize — Brain</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f0f0f; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 2rem; width: 100%; max-width: 360px; }
    h1 { margin: 0 0 0.35rem; font-size: 1.2rem; font-weight: 600; }
    .sub { color: #666; font-size: 0.85rem; margin: 0 0 1.5rem; }
    label { display: block; font-size: 0.82rem; color: #999; margin-bottom: 0.3rem; }
    input[type=text], input[type=password] { display: block; width: 100%; padding: 0.55rem 0.75rem; background: #111; border: 1px solid #2a2a2a; border-radius: 6px; color: #e0e0e0; font-size: 0.9rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #444; }
    button { display: block; width: 100%; padding: 0.65rem; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 0.9rem; font-weight: 500; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { color: #f87171; font-size: 0.85rem; margin-bottom: 1rem; padding: 0.5rem 0.75rem; background: rgba(248,113,113,0.08); border-radius: 6px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Authorize Brain</h1>
    <p class="sub">Sign in to connect your Brain to Claude</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <label for="login">Username</label>
      <input type="text" id="login" name="login" autocomplete="username" required>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <button type="submit">Sign in &amp; Authorize</button>
    </form>
  </div>
</body>
</html>`;
}

function registerOAuthRoutes(app, ctx) {
  const { tenancy } = ctx;
  const baseUrl = (process.env.BRAIN_BASE_URL || 'https://my-brain-dashboard-late-cloud-6699.fly.dev').replace(/\/$/, '');

  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  app.get('/oauth/authorize', (req, res) => {
    const { response_type, redirect_uri, state, client_id, code_challenge, code_challenge_method } = req.query;
    if (response_type !== 'code') return res.status(400).send('unsupported_response_type');
    if (!redirect_uri || !isValidRedirectUri(redirect_uri)) return res.status(400).send('invalid_redirect_uri');
    res.send(authorizeHtml({
      redirectUri: redirect_uri,
      state,
      clientId: client_id,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
    }));
  });

  app.post('/oauth/authorize', express.urlencoded({ extended: false }), async (req, res) => {
    const { redirect_uri, state, client_id, code_challenge, code_challenge_method, login, password } = req.body || {};
    if (!redirect_uri || !isValidRedirectUri(redirect_uri)) return res.status(400).send('invalid_redirect_uri');

    let userId;
    try {
      const reg = registryDb.openRegistryReadWrite(tenancy.registryDbPath());
      const row = registryDb.findUserByLogin(reg, String(login || '').trim());
      reg.close();
      if (!row) throw new Error('invalid');
      const ok = await bcrypt.compare(String(password || ''), row.password_hash);
      if (!ok) throw new Error('invalid');
      userId = row.id;
    } catch (_) {
      return res.send(authorizeHtml({
        redirectUri: redirect_uri,
        state,
        clientId: client_id,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        error: 'Invalid username or password',
      }));
    }

    cleanExpiredCodes();
    const code = crypto.randomBytes(32).toString('base64url');
    console.log('[oauth/authorize] issuing code, redirect_uri:', redirect_uri);
    pendingCodes.set(code, {
      userId,
      redirectUri: redirect_uri,
      expiresAt: Date.now() + CODE_TTL_MS,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
    });

    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);
    res.redirect(302, callbackUrl.toString());
  });

  app.post('/oauth/token', express.urlencoded({ extended: false }), async (req, res) => {
    console.log('[oauth/token] body:', JSON.stringify(req.body), 'content-type:', req.headers['content-type']);
    const { grant_type, code, redirect_uri, code_verifier } = req.body || {};
    if (grant_type !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    if (!code) return res.status(400).json({ error: 'invalid_request' });

    cleanExpiredCodes();
    const entry = pendingCodes.get(code);
    console.log('[oauth/token] entry found:', !!entry, 'codes in map:', pendingCodes.size);
    if (!entry || entry.expiresAt <= Date.now()) {
      console.log('[oauth/token] invalid_grant: entry missing or expired');
      return res.status(400).json({ error: 'invalid_grant' });
    }
    if (entry.redirectUri !== redirect_uri) {
      console.log('[oauth/token] invalid_grant: redirect_uri mismatch. stored:', entry.redirectUri, 'got:', redirect_uri);
      return res.status(400).json({ error: 'invalid_grant' });
    }

    if (entry.codeChallenge) {
      if (!code_verifier) {
        console.log('[oauth/token] invalid_grant: code_verifier missing');
        return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier required' });
      }
      const challenge = crypto.createHash('sha256').update(String(code_verifier)).digest('base64url');
      if (challenge !== entry.codeChallenge) {
        console.log('[oauth/token] invalid_grant: pkce mismatch. computed:', challenge, 'stored:', entry.codeChallenge);
        return res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier mismatch' });
      }
    }

    pendingCodes.delete(code);

    let apiToken;
    try {
      const reg = registryDb.openRegistryReadWrite(tenancy.registryDbPath());
      const row = reg.prepare('SELECT api_token FROM users WHERE id = ?').get(entry.userId);
      if (!row) throw new Error('user not found');
      if (row.api_token) {
        apiToken = row.api_token;
      } else {
        apiToken = crypto.randomBytes(32).toString('hex');
        reg.prepare('UPDATE users SET api_token = ? WHERE id = ?').run(apiToken, entry.userId);
        console.log('[oauth/token] generated new api_token for user', entry.userId);
      }
      reg.close();
    } catch (err) {
      console.error('[oauth/token] server_error:', err.message);
      return res.status(500).json({ error: 'server_error' });
    }

    console.log('[oauth/token] success, returning token');
    res.json({ access_token: apiToken, token_type: 'bearer' });
  });
}

module.exports = { registerOAuthRoutes };
