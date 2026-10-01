import type { EntityReportLink } from '@digitaplatform/shared';
import type { SessionUser } from '@/types';
import { evaluateExpr } from '@/lib/expression';

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

function readPath(doc: Doc, path: string): unknown {
  let value: unknown = doc;
  for (const seg of path.split('.')) {
    value = (value as Doc | undefined)?.[seg];
  }
  return value;
}

/**
 * Resolve `param_map` (report param -> doc field path) against the doc, and the link's `locale`
 * path into the render's `locale`. An empty language sends none, so the definition's locale prints.
 */
export function resolveReportParams(link: EntityReportLink, doc: Doc): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [param, path] of Object.entries(link.param_map ?? {})) {
    const value = readPath(doc, path);
    if (value !== undefined && value !== null) params[param] = String(value);
  }
  const locale = link.locale ? readPath(doc, link.locale) : undefined;
  if (locale !== undefined && locale !== null && locale !== '') params['locale'] = String(locale);
  return params;
}

export function reportRenderUrl(
  report: string,
  params: Record<string, string>,
  format: 'html' | 'pdf' | 'png' | 'csv',
  opts: { print?: boolean; source?: string } = {},
): string {
  const query = new URLSearchParams({ format, ...params });
  // A locale does not apply to csv, and a malformed one would fail the export.
  if (format === 'csv') query.delete('locale');
  // Only a csv export picks one collection; the other formats render the whole report.
  if (format === 'csv' && opts.source) query.set('source', opts.source);
  if (opts.print) query.set('print', '1');
  return `${REPORT_URL}/api/v1/report/definitions/${encodeURIComponent(report)}/render?${query.toString()}`;
}

/**
 * Affordance-only show_if for report links, read by the app's evaluator of a field's depends_on: the
 * doc as `doc`, the signed-in user as `user`, and any other unquoted word as text. The engine refuses
 * such a word in an action's show_if, so one rule can decide differently on an action and on a print
 * link. A rule that does not parse fails OPEN — the report service stays the security boundary; this
 * only hides obviously-inapplicable buttons.
 */
export function reportLinkVisible(link: EntityReportLink, doc: Doc, user?: SessionUser | null): boolean {
  const expr = link.show_if?.replace(/^eval:/, '').trim();
  if (!expr) return true;
  const result = evaluateExpr(expr, { doc, user: user ? (user as unknown as Doc) : undefined, hasBareWords: true });
  return result.error ? true : result.value;
}