import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LinkDefinition } from '@digitaplatform/shared';
import { Badge } from '@digitaplatform/components';
import { useMetaCatalog } from '@/hooks/useMeta';
import { getRelatedDocs } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { toUiMessages, unwrap } from '@/lib/api-result';
import { objectFilterToTuples } from '@/lib/filter-from-url';
import { useI18nStore } from '@/stores/i18n';
import { resolveIcon } from '@/lib/icon-registry';
import { tid } from '@/lib/testid';

/**
 * The record's `links`: one entry per link whose entity the caller may select, with the count
 * the related route answers where the link sets `show_count`. An entry opens the list of the
 * linked entity with the filter the route counts by, `link_field` = the record plus the link's
 * `filters`, so the list shows the rows the count counted. An entry draws the link's `icon` where the
 * icon registry knows the name, and is label-only otherwise, as an action button is.
 */
export function LinksPanel({ entity, name, links }: { entity: string; name: string; links: LinkDefinition[] }) {
  const catalog = useMetaCatalog();
  const t = useI18nStore((s) => s.t);
  const related = useQuery({
    queryKey: qk.relatedDocs(entity, name),
    queryFn: async () => unwrap(await getRelatedDocs(entity, name)),
    // Only a link that shows a count needs the route.
    enabled: links.some((link) => link.show_count),
  });

  // The meta catalog lists only the entities the caller may select, so a link to any other
  // entity gets no entry rather than a count of 0 and a list the caller cannot open.
  const readable = links.filter((link) => catalog.data?.some((s) => s.name === link.entity));
  if (readable.length === 0) return null;
  const failure = related.isError ? toUiMessages(related.error, t)[0]?.text : undefined;

  return (
    <div className="flex flex-wrap gap-2" {...tid.component('record-links', entity)}>
      {readable.map((link, i) => {
        // The route answers one entry per declared link, in declaration order.
        const answer = related.data?.[links.indexOf(link)];
        const count = answer?.entity === link.entity ? answer.count : undefined;
        const refusal = answer?.entity === link.entity ? answer.error : undefined;
        const filter = JSON.stringify(objectFilterToTuples({ [link.link_field]: name, ...link.filters }));
        const Icon = resolveIcon(link.icon);
        return (
          <Link
            key={i}
            to={{ pathname: `/${link.entity}`, search: `?${new URLSearchParams({ f: filter })}` }}
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-textMain hover:bg-bgHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {link.label}{' '}
            {link.show_count && typeof count === 'number' && <Badge size="sm">{count}</Badge>}
            {link.show_count && typeof count !== 'number' && !related.isPending && (
              <Badge size="sm" title={refusal ?? failure}>
                —
              </Badge>
            )}
          </Link>
        );
      })}
    </div>
  );
}
