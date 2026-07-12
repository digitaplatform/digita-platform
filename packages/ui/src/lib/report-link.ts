import type { EntityReportLink } from '@digitaplatform/shared';

/**
 * Entity↔report links (metadata-driven print buttons): URL building and
 * doc-side resolution for the digita-report service. Auth rides on the
 * shared parent-domain SSO cookie — the report host is same-site, so the
 * embedded/openend render is authenticated automatically.
 */

type Doc = Record<string, unknown>;

/**
 * The report service lives at report.<tenant-host>: swap the first host
 * label (erp./admin./…) — single-origin dev setups fall back to the local
 * report backend port.
 */
export function reportBaseUrl(): string {
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3400`;
  }
  const labels = hostname.split('.');
  labels[0] = 'report';
  return `${protocol}//${labels.join('.')}`;
}

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
  return `${reportBaseUrl()}/api/v1/report/definitions/${encodeURIComponent(report)}/render?${query.toString()}`;
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