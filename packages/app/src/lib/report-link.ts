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

/**
 * The entity file writes a link's label in one language, so an app translates it in its locale
 * files under `report.<Entity>.<report>`, keyed like an action label (`action.<Entity>.<action>`).
 * Without a key the written label stands; without either the caller names the link itself.
 */
export function reportLinkLabel(
  entity: string,
  link: EntityReportLink,
  translations: Record<string, string>,
): string | undefined {
  return translations[`report.${entity}.${link.report}`] ?? link.label;
}

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
  opts: { print?: boolean } = {},
): string {
  const query = new URLSearchParams({ format, ...params });
  // The report service answers a csv export that names a locale with 400.
  if (format === 'csv') query.delete('locale');
  if (opts.print) query.set('print', '1');
  return `${REPORT_URL}/api/v1/report/definitions/${encodeURIComponent(report)}/render?${query.toString()}`;
}

/**
 * Affordance-only show_if for report links, read with the grammar of an action's show_if: the doc
 * as `doc`, the signed-in user as `user`. A rule that does not parse fails OPEN — the report
 * service stays the security boundary; this only hides obviously-inapplicable buttons.
 */
export function reportLinkVisible(link: EntityReportLink, doc: Doc, user?: SessionUser | null): boolean {
  const expr = link.show_if?.replace(/^eval:/, '').trim();
  if (!expr) return true;
  const result = evaluateExpr(expr, { doc, user: user ? (user as unknown as Doc) : undefined });
  return result.error ? true : result.value;
}