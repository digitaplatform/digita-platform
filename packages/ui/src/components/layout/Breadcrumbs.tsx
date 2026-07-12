import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useMetaCatalog } from '@/hooks/useMeta';
import { useRecordTitle } from '@/stores/record-title';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import type { EntitySummary } from '@/types';

/**
 * Route + meta-derived breadcrumb trail — PURE (no network of its own; the meta
 * catalog is the shared session-cached query and the record title is the seam
 * RecordPage publishes). Mounted in the Topbar left slot.
 *
 * Trail shapes:
 *   /                         → Home
 *   /:entity                  → Home › plural
 *   /:entity/new              → Home › plural › New
 *   /:entity/:name            → Home › plural › (recordTitle on exact match, else raw :name dimmed)
 *   is_single :entity         → Home › singular              (one leaf crumb, no plural list link)
 *   /app/* or unknown entity  → render nothing (unknown ROUTED entity → raw segment + DEV warn)
 *
 * Absence is graceful (raw :name is the legitimate business key, not a mask);
 * a routed-but-unknown entity is a drift signal → DEV console.warn.
 */

interface Crumb {
  label: string;
  to?: string; // present → <Link>; absent → leaf (current page)
  dimmed?: boolean; // raw :name not yet resolved by the title seam
}

export function Breadcrumbs() {
  const params = useParams();
  const tc = useChrome();
  const tEntity = useI18nStore((s) => s.tEntity);
  const catalog = useMetaCatalog();
  const titleSeam = useRecordTitle();

  const entityName = params.entity;
  const recordName = params.name; // present on /:entity/:name and /:entity/new ("new")
  const splat = params['*']; // present on /app/* (a splat route) — plugin-owned

  const homeCrumb: Crumb = { label: tc('ui.crumb.home'), to: '/' };

  // /app/* (and any splat route): plugin pages own their own header → render nothing.
  if (splat !== undefined) return null;

  // No :entity param (the index route "/") → just Home.
  if (!entityName) return <Trail crumbs={[homeCrumb]} />;

  // Resolve the entity summary. While the catalog is still loading we cannot tell
  // a real entity from an unknown one — render Home + the raw plural-ish segment
  // (calm, no warn) rather than guessing.
  const summaries: EntitySummary[] = catalog.data ?? [];
  const summary = summaries.find((s) => s.name === entityName);

  if (!summary) {
    // Catalog loaded but the routed entity is unknown → drift. Show the raw
    // segment and warn loudly in dev. While still loading, stay calm.
    if (!catalog.isLoading && catalog.data) {
      if (import.meta.env.DEV) {
        console.warn(`[breadcrumbs] routed entity "${entityName}" is not in the meta catalog`);
      }
    }
    return <Trail crumbs={[homeCrumb, { label: entityName }]} />;
  }

  // label_plural is localized at the meta seam (tEntity only resolves the singular key).
  const pluralLabel = summary.label_plural ?? summary.label ?? summary.name;
  const singularLabel = tEntity(summary.name, summary.label ?? summary.name);

  // is_single → the entity IS the page (no list). One leaf crumb after Home.
  if (summary.is_single) {
    return <Trail crumbs={[homeCrumb, { label: singularLabel }]} />;
  }

  const listCrumb: Crumb = { label: pluralLabel, to: `/${encodeURIComponent(entityName)}` };

  if (!recordName) {
    // /:entity — list view; plural is the leaf.
    return <Trail crumbs={[homeCrumb, { ...listCrumb, to: undefined }]} />;
  }

  if (recordName === 'new') {
    return <Trail crumbs={[homeCrumb, listCrumb, { label: tc('ui.crumb.new') }]} />;
  }

  // /:entity/:name — leaf is the published record title ONLY on an exact
  // (entity, name) match; otherwise the raw :name, dimmed (not yet loaded).
  const exactMatch =
    titleSeam.entity === entityName && titleSeam.name === recordName && !!titleSeam.title;
  const leaf: Crumb = exactMatch
    ? { label: titleSeam.title! }
    : { label: recordName, dimmed: true };

  return <Trail crumbs={[homeCrumb, listCrumb, leaf]} />;
}

function Trail({ crumbs }: { crumbs: Crumb[] }) {
  const tc = useChrome();
  return (
    <nav aria-label={tc('ui.crumb.label')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && (
                <li aria-hidden="true" className="shrink-0 text-textMuted">
                  <ChevronRight className="h-4 w-4" />
                </li>
              )}
              <li className="min-w-0">
                {crumb.to && !isLast ? (
                  <Link
                    to={crumb.to}
                    className="block truncate text-textMuted hover:text-textMain hover:underline"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={
                      isLast
                        ? crumb.dimmed
                          ? 'block truncate font-medium text-textMuted'
                          : 'block truncate font-medium text-textMain'
                        : 'block truncate text-textMuted'
                    }
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
