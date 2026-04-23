'use strict';

const crypto = require('crypto');
const tenancy = require('../tenancy/tenancy-utils.js');

const SESS_COOKIE = 'brain_sess';
const SESS_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days

function dashboardAuthEnabled() {
  return Boolean(process.env.SESSION_SECRET && String(process.env.SESSION_SECRET).length >= 32);
}

function sessionSigningKey() {
  return crypto.createHmac('sha256', 'brain-dashboard-sess-multi-v1')
    .update(String(process.env.SESSION_SECRET || ''))
    .digest();
}

function signSessionPayload(obj) {
  const key = sessionSigningKey();
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionPayload(payloadB64, sig) {
  const key = sessionSigningKey();
  const expected = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
  try {
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
  } catch (_) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload.exp || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) > payload.exp) return null;
  if (!payload.sub || typeof payload.sub !== 'string') return null;
  if (!tenancy.TENANT_USER_ID_RE.test(payload.sub)) return null;
  return payload;
}

function parseSessionFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESS_COOKIE}=([^;]+)`));
  if (!m) return null;
  const raw = decodeURIComponent(m[1].trim());
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  return verifySessionPayload(payloadB64, sig);
}

function verifySessionCookie(cookieHeader) {
  return Boolean(parseSessionFromCookie(cookieHeader));
}

function setSessionCookie(res, token, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESS_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [`${SESS_COOKIE}=`, 'HttpOnly', 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = {
  SESS_COOKIE,
  SESS_MAX_AGE_SEC,
  dashboardAuthEnabled,
  signSessionPayload,
  parseSessionFromCookie,
  verifySessionCookie,
  setSessionCookie,
  clearSessionCookie,
};
