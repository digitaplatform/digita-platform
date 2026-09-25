import type { EntityReportLink } from '@digitaplatform/shared';

/**
 * Entity↔report links (metadata-driven print buttons): URL building and
 * doc-side resolution for the digita-report service. Auth rides on the
 * tenant session cookie, so the embedded/opened render is authenticated
 * automatically.
 */

type Doc = Record<string, unknown>;

/**
 * The report service's base URL. Resolution order, as for AUTH_URL (lib/authConfig.ts):
 *   1. window.__REPORT_URL__ — written into /env.js from the REPORT_URL env (docker/app-env.sh);
 *   2. VITE_REPORT_URL — build-time override for local setups;
 *   3. http://localhost:3400 — the digita-report backend dev server.
 */
const injectedReportUrl =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, unknown>).__REPORT_URL__ as string | undefined)
    : undefined;

export const REPORT_URL: string = (
  injectedReportUrl ||
  (import.meta.env.VITE_REPORT_URL as string | undefined) ||
  'http://localhost:3400'
).replace(/\/+$/, '');

/** Resolve `param_map` (report param -> doc field path) against the doc. */
export function resolveReportParams(link: EntityReportLink, doc: Doc): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [param, path] of Object.entries(link.param_map ?? {})) {
    let value: unknown = doc;
    for (const seg of path.split('.')) {
      value = (value as Doc | undefined)?.[seg];
    }
    if (value !== undefined && value !== null) params[param] = String(value);
  }
  return params;
}

export function reportRenderUrl(
  report: string,
  params: Record<string, string>,
  format: 'html' | 'pdf' | 'png' | 'csv',
  opts: { print?: boolean } = {},
): string {
  const query = new URLSearchParams({ format, ...params });
  if (opts.print) query.set('print', '1');
  return `${REPORT_URL}/api/v1/report/definitions/${encodeURIComponent(report)}/render?${query.toString()}`;
}

/**
 * Affordance-only show_if for report links: supports the eval subset the
 * shipped links use (`doc.field == literal`, `!=`, bare truthiness).
 * Unknown expressions fail OPEN — the engine/report service stays the
 * security boundary; this only hides obviously-inapplicable buttons.
 */
export function reportLinkVisible(link: EntityReportLink, doc: Doc): boolean {
  const expr = link.show_if?.replace(/^eval:/, '').trim();
  if (!expr) return true;
  const m = /^doc\.([\w.]+)\s*(==|!=)\s*(.+)$/.exec(expr);
  if (m) {
    const [, path, op, rawLit] = m;
    let value: unknown = doc;
    for (const seg of (path as string).split('.')) {
      value = (value as Doc | undefined)?.[seg];
    }
    const lit = (rawLit as string).trim().replace(/^['"]|['"]$/g, '');
    const litValue: unknown = lit === 'true' ? true : lit === 'false' ? false : /^-?\d+(\.\d+)?$/.test(lit) ? Number(lit) : lit;
    const equal = value === litValue || String(value) === String(litValue);
    return op === '==' ? equal : !equal;
  }
  const bare = /^doc\.([\w.]+)$/.exec(expr);
  if (bare) {
    let value: unknown = doc;
    for (const seg of (bare[1] as string).split('.')) {
      value = (value as Doc | undefined)?.[seg];
    }
    return Boolean(value);
  }
  return true;
}