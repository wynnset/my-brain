/**
 * stdio MCP server: unified web fetch.
 *
 * Tries plain HTTP first and auto-escalates to headless Chromium when the
 * response looks JS-required or bot-blocked. Default returns clean text via
 * Mozilla Readability; format/load_resources/max_chars knobs let the model
 * opt into heavier behavior per call.
 *
 * Started when BRAIN_CHAT_MCP_BROWSER=1. One Chromium fetch at a time per
 * process (queued) to limit RAM on small VMs.
 */
import net from 'node:net';
import dns from 'node:dns/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  cacheGet,
  cacheSet,
  extractFromHtml,
  looksLikeJsRequired,
  truncate,
} from './lib/web-extract.mjs';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const BROWSER_TIMEOUT_MS = clamp(
  Number(process.env.BRAIN_BROWSER_FETCH_TIMEOUT_MS) || 45000,
  5000,
  120000,
);
const POST_WAIT_MS = clamp(
  Number(process.env.BRAIN_BROWSER_FETCH_POST_WAIT_MS) || 2000,
  0,
  30000,
);
const MAX_CHARS_CEILING = clamp(
  Number(process.env.BRAIN_BROWSER_FETCH_MAX_CHARS) || 120000,
  8000,
  500000,
);
const DEFAULT_MAX_CHARS = clamp(
  Number(process.env.BRAIN_FETCH_DEFAULT_MAX_CHARS) || 30000,
  4000,
  MAX_CHARS_CEILING,
);
const HTTP_TIMEOUT_MS = clamp(
  Number(process.env.BRAIN_FETCH_HTTP_TIMEOUT_MS) || 15000,
  2000,
  60000,
);

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Serialize browser fetches — one Chromium instance at a time. */
let chain = Promise.resolve();
function enqueueBrowser(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

class SSRFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SSRFError';
  }
}

function assertPublicIpv4(host) {
  const oct = host.split('.').map((x) => Number(x));
  if (oct.length !== 4 || oct.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return;
  const [a, b] = oct;
  if (a === 10) throw new SSRFError('Private IPv4 range not allowed');
  if (a === 127) throw new SSRFError('Loopback not allowed');
  if (a === 0) throw new SSRFError('Invalid / reserved IPv4');
  if (a === 169 && b === 254) throw new SSRFError('Link-local / metadata IPs not allowed');
  if (a === 192 && b === 168) throw new SSRFError('Private IPv4 range not allowed');
  if (a === 172 && b >= 16 && b <= 31) throw new SSRFError('Private IPv4 range not allowed');
}

function assertPublicIpv6(host) {
  const h = host.toLowerCase();
  if (h === '::1') throw new SSRFError('Loopback not allowed');
  if (h.startsWith('fe80:')) throw new SSRFError('Link-local IPv6 not allowed');
  if (h.startsWith('fc') || h.startsWith('fd')) throw new SSRFError('Unique local IPv6 not allowed');
}

async function assertUrlSafe(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SSRFError('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SSRFError('Only http(s) URLs are allowed');
  }
  const host = u.hostname;
  if (!host) throw new SSRFError('Missing host');
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0') {
    throw new SSRFError('Host not allowed');
  }
  if (net.isIP(h)) {
    if (net.isIPv4(h)) assertPublicIpv4(h);
    else assertPublicIpv6(h);
    return;
  }
  let addr;
  try {
    const r = await dns.lookup(h, { verbatim: true, all: false });
    addr = r.address;
  } catch (err) {
    throw new SSRFError(`DNS resolution failed: ${err && err.message ? err.message : err}`);
  }
  if (net.isIPv4(addr)) assertPublicIpv4(addr);
  else assertPublicIpv6(addr);
}

async function fetchHttp(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    const ct = resp.headers.get('content-type') || '';
    const isHtml = /text\/html|application\/xhtml|application\/xml|text\/plain/i.test(ct) || ct === '';
    const text = isHtml ? await resp.text() : '';
    return {
      status: resp.status,
      finalUrl: resp.url || url,
      html: text,
      contentType: ct,
      isHtml,
    };
  } finally {
    clearTimeout(t);
  }
}

async function fetchBrowser(url, loadResources) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
    throw new Error(`Playwright not installed or failed to load: ${msg}`);
  }
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage({ userAgent: UA });
    if (loadResources === 'minimal') {
      const BLOCKED = new Set(['image', 'media', 'font', 'stylesheet']);
      await page.route('**/*', (route) => {
        try {
          if (BLOCKED.has(route.request().resourceType())) return route.abort();
          return route.continue();
        } catch (_) {
          try {
            return route.continue();
          } catch (_) {
            return undefined;
          }
        }
      });
    }
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
    const resp = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: BROWSER_TIMEOUT_MS,
    });
    const status = resp?.status() ?? 0;
    if (POST_WAIT_MS > 0) await new Promise((r) => setTimeout(r, POST_WAIT_MS));
    const html = await page.content();
    const finalUrl = page.url();
    return { status, finalUrl, html };
  } finally {
    try {
      await browser?.close();
    } catch (_) {}
  }
}

const server = new McpServer({ name: 'brain-fetch', version: '1.0.0' });

server.registerTool(
  'brain_fetch',
  {
    title: 'Fetch web page (auto-escalating)',
    description:
      'Fetch a public http(s) URL and return cleaned page content via Mozilla Readability (clean article text, no nav/ads/footers). Tries plain HTTP first; auto-escalates to headless Chromium internally when the response looks JS-required or bot-blocked, so one call covers both paths.\n\n' +
      'When to choose this vs WebFetch:\n' +
      '- Use WebFetch for "pull one fact from one page" — it runs an internal Haiku extraction against the page using your prompt and returns a small answer (cheapest path for single-fact extraction).\n' +
      '- Use brain_fetch when (a) the page is JS-required / bot-walled (Cloudflare, CAPTCHA, "enable JavaScript", empty SPA shell — auto-escalates), (b) you will re-fetch the same URL more than once this session (cached), (c) the page is large and you want cleaned text instead of a Haiku pass over the full thing, or (d) you need raw text to reason over rather than one extracted answer.\n\n' +
      'Knobs:\n' +
      '- mode: "auto" (default) | "http" (skip browser) | "browser" (force Chromium when you already know JS is required).\n' +
      '- format: "text" (default — article body text) | "markdown" (preserves images as ![alt](src), links, headings — use when enumerating media or following links) | "html" (full body HTML with classes / inline styles — use only for styling / DOM-structure questions; expensive on tokens).\n' +
      '- load_resources: "minimal" (default — blocks images/CSS/fonts/media when launching Chromium) | "all" (load everything — needed for accurate rendered layout or computed styles).\n' +
      '- max_chars: per-call truncation cap on returned content. Defaults to ~30k chars; raise it when you genuinely need the whole page.',
    inputSchema: z.object({
      url: z.string().max(8000),
      mode: z.enum(['auto', 'http', 'browser']).optional(),
      format: z.enum(['text', 'markdown', 'html']).optional(),
      load_resources: z.enum(['minimal', 'all']).optional(),
      max_chars: z.number().int().min(1000).max(MAX_CHARS_CEILING).optional(),
    }),
  },
  async ({ url, mode, format, load_resources, max_chars }) => {
    const m = mode || 'auto';
    const f = format || 'text';
    const lr = load_resources || 'minimal';
    const cap = clamp(max_chars ?? DEFAULT_MAX_CHARS, 1000, MAX_CHARS_CEILING);

    try {
      await assertUrlSafe(url);
    } catch (e) {
      const msg = e instanceof SSRFError ? e.message : 'URL validation failed';
      return errorResp(url, msg);
    }

    const cacheKey = JSON.stringify({ url, mode: m, format: f, load_resources: lr, cap });
    const cached = cacheGet(cacheKey);
    if (cached) return { content: [{ type: 'text', text: cached }] };

    let html = null;
    let status = 0;
    let finalUrl = url;
    let path = m;
    let escalated = false;
    let httpError = null;

    if (m === 'http' || m === 'auto') {
      try {
        const r = await fetchHttp(url);
        status = r.status;
        finalUrl = r.finalUrl;
        html = r.isHtml ? r.html : null;
        if (!r.isHtml && m === 'http') {
          return errorResp(
            url,
            `non-HTML content-type "${r.contentType}" — brain_fetch only handles HTML pages`,
          );
        }
      } catch (e) {
        httpError = e?.message || String(e);
        if (m === 'http') return errorResp(url, `http fetch failed: ${httpError}`);
      }

      if (m === 'auto') {
        let preview = '';
        if (html) {
          try {
            preview = extractFromHtml(html, finalUrl, 'text').body;
          } catch (_) {}
        }
        if (httpError || looksLikeJsRequired(html, status, preview)) {
          escalated = true;
        } else {
          path = 'http';
        }
      } else {
        path = 'http';
      }
    }

    if (m === 'browser' || escalated) {
      try {
        const r = await enqueueBrowser(() => fetchBrowser(url, lr));
        html = r.html;
        status = r.status;
        finalUrl = r.finalUrl;
        path = escalated ? 'browser (escalated from http)' : 'browser';
      } catch (e) {
        return errorResp(url, `browser fetch failed: ${e?.message || e}`);
      }
    }

    if (!html) {
      return errorResp(url, 'no HTML body retrieved');
    }

    let extracted;
    try {
      extracted = extractFromHtml(html, finalUrl, f);
    } catch (e) {
      return errorResp(url, `extraction failed: ${e?.message || e}`);
    }

    const payload = {
      url,
      finalUrl,
      httpStatus: status,
      title: extracted.title,
      byline: extracted.byline || undefined,
      path,
      format: f,
      readability: extracted.usedReadability,
      content: truncate(extracted.body, cap),
      ...(status >= 400
        ? { note: 'HTTP error status — content may be an error or interstitial page.' }
        : {}),
    };
    const text = JSON.stringify(payload, null, 2);
    cacheSet(cacheKey, text);
    return { content: [{ type: 'text', text }] };
  },
);

function errorResp(url, detail) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: 'brain_fetch failed', url, detail }) }],
    isError: true,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
