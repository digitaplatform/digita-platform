/**
 * Returns `url` only when it resolves to an http(s) (or a relative) location.
 * Stored field values (e.g. a file_url) are rendered into `href`/`src`; without
 * this gate a `javascript:` / `data:` / `vbscript:` value becomes a stored-XSS
 * sink for any later viewer. Relative paths resolve against the current origin,
 * so they keep their http(s) protocol and pass. Anything else → `undefined`
 * (the caller renders plain text instead of a link/image).
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(value, base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}
