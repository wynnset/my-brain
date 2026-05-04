/**
 * Shared content-extraction helpers for the brain_fetch MCP tool.
 *
 * - JSDOM + Mozilla Readability cleans page chrome (nav/footer/ads) from
 *   article-like pages, dropping ~60-85% of tokens vs raw innerText.
 * - turndown converts the cleaned HTML to markdown when the caller needs
 *   to see images / links / structure rather than just prose.
 * - Tiny in-memory LRU caches the extracted payload by request shape so
 *   re-fetching the same URL within a session avoids the work entirely.
 */
import { JSDOM } from 'jsdom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

const CACHE_TTL_MS = Math.min(
  60 * 60 * 1000,
  Math.max(10 * 1000, Number(process.env.BRAIN_FETCH_CACHE_TTL_MS) || 5 * 60 * 1000),
);
const CACHE_MAX_ENTRIES = Math.min(
  2000,
  Math.max(10, Number(process.env.BRAIN_FETCH_CACHE_MAX) || 200),
);

/** @type {Map<string, { ts: number, value: string }>} */
const cache = new Map();

export function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

export function cacheSet(key, value) {
  cache.set(key, { ts: Date.now(), value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function truncate(s, max) {
  const t = String(s || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated at ${max} chars)`;
}

/**
 * @param {string} html
 * @param {string} url used as JSDOM base for relative links
 * @param {'text'|'markdown'|'html'} format
 * @returns {{ title: string, byline: string|null, body: string, usedReadability: boolean }}
 */
export function extractFromHtml(html, url, format = 'text') {
  if (!html) return { title: '', byline: null, body: '', usedReadability: false };

  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const docTitle = doc.title || '';

  // format='html' returns full body HTML so the caller can inspect classes,
  // inline styles, and structure — Readability would strip most of that.
  if (format === 'html') {
    const body = doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
    return { title: docTitle, byline: null, body: body || '', usedReadability: false };
  }

  let article = null;
  try {
    if (isProbablyReaderable(doc)) {
      // Readability mutates the DOM it's given, so clone first.
      const clone = doc.cloneNode(true);
      article = new Readability(clone).parse();
    }
  } catch (_) {
    article = null;
  }

  if (article && article.content) {
    const body =
      format === 'markdown' ? turndown.turndown(article.content) : article.textContent || '';
    return {
      title: article.title || docTitle,
      byline: article.byline || null,
      body: body || '',
      usedReadability: true,
    };
  }

  // Fallback for non-article pages (search results, dashboards, indices).
  const bodyEl = doc.body;
  const fallback =
    format === 'markdown'
      ? turndown.turndown(bodyEl?.innerHTML || '')
      : bodyEl?.textContent || '';
  return {
    title: docTitle,
    byline: null,
    body: collapseWhitespace(fallback),
    usedReadability: false,
  };
}

function collapseWhitespace(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const JS_REQUIRED_PATTERNS = [
  /please enable javascript/i,
  /enable javascript to (run|view|continue)/i,
  /requires javascript to/i,
  /<noscript[^>]*>[\s\S]{60,}?<\/noscript>/i,
  /cf-browser-verification/i,
  /just a moment\s*\.\.\./i,
  /attention required.*cloudflare/i,
  /captcha/i,
  /__NEXT_DATA__\s*=\s*null/i,
];

const SHELL_PATTERNS = [
  /<div\s+id=["'](root|app|__next|svelte)["']\s*>\s*<\/div>/i,
  /<body[^>]*>\s*<script/i,
];

/**
 * Decide whether a plain-HTTP response is bot-blocked or a JS-rendered shell
 * and we should escalate to a real browser. Conservative: only trips on
 * explicit signals so we don't waste a Chromium launch on legitimately small
 * static pages.
 *
 * @param {string|null} html
 * @param {number} status
 * @param {string} extractedText  text content already pulled out via Readability
 * @returns {boolean}
 */
export function looksLikeJsRequired(html, status, extractedText) {
  if (status === 0 || (status >= 500 && status <= 599)) return true;
  if (status === 403 || status === 429) return true;
  if (!html) return true;

  if (JS_REQUIRED_PATTERNS.some((re) => re.test(html))) return true;
  if (SHELL_PATTERNS.some((re) => re.test(html))) return true;

  // Heavy script-to-text ratio with negligible visible text — almost
  // certainly a SPA shell that hasn't run its bundle yet.
  const extractedLen = (extractedText || '').trim().length;
  if (extractedLen < 80) {
    const scriptTags = (html.match(/<script\b/gi) || []).length;
    if (scriptTags >= 3) return true;
  }

  return false;
}
