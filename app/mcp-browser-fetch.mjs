/**
 * stdio MCP server: headless Chromium fetch for pages that break simple HTTP.
 * Started when BRAIN_CHAT_MCP_BROWSER=1. One fetch at a time per process
 * (queued) to limit RAM on small VMs.
 */
import net from 'node:net';
import dns from 'node:dns/promises';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const TIMEOUT_MS = Math.min(120000, Math.max(5000, Number(process.env.BRAIN_BROWSER_FETCH_TIMEOUT_MS) || 45000));
const POST_WAIT_MS = Math.min(30000, Math.max(0, Number(process.env.BRAIN_BROWSER_FETCH_POST_WAIT_MS) || 2000));
const MAX_CHARS = Math.min(500000, Math.max(8000, Number(process.env.BRAIN_BROWSER_FETCH_MAX_CHARS) || 120000));

/** Serialize fetches — one browser instance at a time. */
let chain = Promise.resolve();
function enqueue(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
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

class SSRFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SSRFError';
  }
}

/**
 * @param {string} rawUrl
 */
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

function truncate(s, max) {
  const t = String(s || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated at ${max} chars)`;
}

/**
 * @param {string} rawUrl
 * @param {import('playwright').Page} page
 */
async function loadPage(rawUrl, page) {
  page.setDefaultTimeout(TIMEOUT_MS);
  const resp = await page.goto(rawUrl, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  });
  const status = resp?.status() ?? 0;
  if (POST_WAIT_MS > 0) {
    await new Promise((r) => setTimeout(r, POST_WAIT_MS));
  }
  const title = (await page.title()) || '';
  const finalUrl = page.url();
  const text = await page.evaluate(() => {
    try {
      const b = document.body;
      if (!b) return '';
      return b.innerText || '';
    } catch {
      return '';
    }
  });
  return { status, title, finalUrl, text: text || '' };
}

const server = new McpServer({ name: 'brain-browser', version: '1.0.0' });

server.registerTool(
  'browser_fetch',
  {
    title: 'Headless browser page text',
    description:
      'Load a public http(s) URL in headless Chromium and return visible page text (innerText). Use when WebFetch returns bot challenges (Cloudflare, CAPTCHA), empty shells, or “enable JavaScript” pages — not for routine fetches. Respects the same research intent as WebFetch but runs a real browser (slower, heavier).',
    inputSchema: z.object({
      url: z.string().max(8000),
    }),
  },
  async ({ url }) => {
    try {
      await assertUrlSafe(url);
    } catch (e) {
      const msg = e instanceof SSRFError ? e.message : 'URL validation failed';
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: msg, url }) }],
        isError: true,
      };
    }

    return enqueue(async () => {
      let chromium;
      let browser;
      try {
        ({ chromium } = await import('playwright'));
      } catch (e) {
        const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Playwright not installed or failed to load', detail: msg }),
            },
          ],
          isError: true,
        };
      }

      try {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });
        const page = await browser.newPage({
          userAgent:
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        const { status, title, finalUrl, text } = await loadPage(url, page);
        const payload = {
          url,
          finalUrl,
          httpStatus: status,
          title,
          text: truncate(text, MAX_CHARS),
          note:
            status >= 400
              ? 'HTTP error status — text may be an error or interstitial page.'
              : undefined,
        };
        const line = JSON.stringify(payload, null, 2);
        return { content: [{ type: 'text', text: line }] };
      } catch (e) {
        const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'browser_fetch failed', url, detail: msg }) }],
          isError: true,
        };
      } finally {
        try {
          await browser?.close();
        } catch (_) {}
      }
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
