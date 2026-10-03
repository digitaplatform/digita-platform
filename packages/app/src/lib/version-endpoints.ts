/** Public image metadata addresses supplied at runtime, including configured legacy services. */
export function versionEndpoints(): string[] {
  if (typeof window === 'undefined') return [];
  const runtime = window as unknown as Record<string, unknown>;
  const value = runtime.__VERSION_ENDPOINTS__;
  const urls = typeof value === 'string' ? value.split(',').filter(Boolean) : [];
  for (const [key, frontend] of [['__AUTH_URL__', true], ['__JOBS_URL__', false], ['__REPORT_URL__', true]] as const) {
    const configured = runtime[key];
    if (typeof configured !== 'string' || !configured) continue;
    const base = configured.replace(/\/+$/, '');
    urls.push(`${base}/health`);
    if (frontend) urls.push(`${base}/health/frontend`);
  }
  return [...new Set(urls)];
}
