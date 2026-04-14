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
