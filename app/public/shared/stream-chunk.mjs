/**
 * Join SSE text chunks so sentence boundaries do not glue (e.g. "now." + "Good" → "now. Good").
 * Only inserts a space when the prior text ends in . ! ? (ignoring trailing closers) and the chunk
 * starts with a letter without leading whitespace.
 *
 * Shared by the Node server, chat-sdk-runner, and the dashboard client (same file on disk).
 */
export function appendAssistantStreamChunk(existing, chunk) {
  const e = String(existing || '');
  const c = String(chunk || '');
  if (!c) return e;
  if (!e) return c;
  const fc = c.charCodeAt(0);
  if (fc === 32 || fc === 10 || fc === 13 || fc === 9) return e + c;
  const t = e.replace(/[\s\u00a0]+$/g, '');
  if (!t) return e + c;
  let j = t.length - 1;
  while (j >= 0 && /['")\]\u2019\u201d]/.test(t[j])) j -= 1;
  const punct = j >= 0 ? t[j] : '';
  if (punct === '.' || punct === '!' || punct === '?' || punct === '\u2026') {
    if (/[A-Za-z]/.test(c[0])) return `${e} ${c}`;
  }
  return e + c;
}

/**
 * Normalize a raw subagent identifier (from `Task` / `Agent` tool_input) to a simple
 * slug: lowercased, hyphens and whitespace folded to underscores. Returns '' for
 * empty / non-scalar input so callers can short-circuit.
 */
export function normalizeSubagentIdSlug(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  return s.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

/**
 * Built-in Claude Agent SDK subagent preset ids (general-purpose, explore, shell, …).
 * These are NOT team-member slugs; neither the server nor the client should open a
 * dedicated "<name> is working" panel for them — the parent agent stays the speaker.
 */
const GENERIC_SDK_SUBAGENT_SLUGS = new Set([
  'explore',
  'generalpurpose',
  'general_purpose',
  'plan',
  'shell',
  'cursor_guide',
  'best_of_n_runner',
]);

export function isGenericSdkSubagentId(raw) {
  const slug = normalizeSubagentIdSlug(raw);
  if (!slug) return false;
  return GENERIC_SDK_SUBAGENT_SLUGS.has(slug);
}
