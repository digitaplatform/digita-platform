import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { CommandPalette as KitCommandPalette, Spinner } from '@digitaplatform/components';
import { useUiStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { useNavigableCatalog } from '@/hooks/useNavigableCatalog';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { buildCommandItems, filterCommandItems, type CommandItem } from './use-command-items';
import type { GlobalSearchResult } from '@/services/search';

/**
 * The command palette HOST: owns the ui store's open flag, the navigable
 * catalog, the debounced global search, the session roles and the router, and
 * hands the kit `CommandPalette` its rows. Nav items come first, then the record
 * hits of the search; the kit owns the keyboard, the focus trap and the
 * highlight. The query is controlled here because the record hits are searched
 * on the server, so the kit must not re-filter them by substring.
 *
 * Mounted ONCE by ShellRenderer (universal chrome). The Cmd/Ctrl-K hotkey is
 * registered by the shell; this component reacts to the ui store's
 * commandPaletteOpen flag.
 */

const SEARCH_DEBOUNCE_MS = 180;

/** A hit becomes a row only when it resolves to a route. */
function hitToItem(hit: GlobalSearchResult, group: string): CommandItem | null {
  const entity = (hit.entity || hit.doctype) as string | undefined;
  const name = (hit.name || hit._id) as string | undefined;
  if (!entity || !name) return null;
  return {
    id: `record:${entity}:${name}`,
    group,
    label: (hit.title || hit.display || name) as string,
    sublabel: entity,
    to: `/${entity}/${name}`,
  };
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPalette);
  const navigate = useNavigate();
  const tc = useChrome();

  const hasRole = useSessionStore((s) => s.hasRole);
  const tEntity = useI18nStore((s) => s.tEntity);

  const { navigable, isLoading: catalogLoading } = useNavigableCatalog();

  // Raw input + a debounced copy that actually drives the network query, so
  // typing doesn't fire a request per keystroke.
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  const searchActive = query.trim().length >= 2;
  const search = useGlobalSearch(open && searchActive ? debounced : '');

  const navItems = useMemo<CommandItem[]>(
    () =>
      buildCommandItems({
        navigable,
        entityLabel: (entity, fallback) => tEntity(entity, fallback),
        tc,
        hasRole,
      }),
    [navigable, tEntity, tc, hasRole],
  );

  const recordsGroup = tc('ui.cmd.recordsGroup');
  const records = useMemo<CommandItem[]>(() => {
    if (!searchActive || search.isError) return [];
    return (search.data ?? []).flatMap((hit) => hitToItem(hit, recordsGroup) ?? []);
  }, [searchActive, search.isError, search.data, recordsGroup]);

  const items = useMemo(
    () => [...filterCommandItems(navItems, query), ...records],
    [navItems, query, records],
  );

  // The catalog still loading counts as a search in flight: the palette must not report
  // "no matches" before it has anything to match against.
  const loading = catalogLoading || (searchActive && (search.isFetching || search.isLoading));
  const status = searchActive && search.isError ? (
    <span className="flex items-center gap-2 text-error">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      {tc('ui.cmd.searchError')}
    </span>
  ) : loading ? (
    <Spinner className="h-4 w-4" />
  ) : searchActive && records.length === 0 ? (
    tc('ui.cmd.noRecords')
  ) : null;

  const navCatalogEmpty = !catalogLoading && navigable.length === 0;

  return (
    <KitCommandPalette
      open={open}
      onClose={() => setOpen(false)}
      items={items}
      onSelect={(item) => {
        setOpen(false);
        navigate(item.to);
      }}
      query={query}
      onQueryChange={setQuery}
      status={status}
      statusGroup={searchActive ? recordsGroup : undefined}
      hints={{ navigate: tc('ui.cmd.hintNavigate'), select: tc('ui.cmd.hintSelect'), close: tc('ui.cmd.hintClose') }}
      placeholder={tc('ui.cmd.placeholder')}
      aria-label={tc('ui.cmd.title')}
      listLabel={tc('ui.cmd.resultsLabel')}
      emptyText={tc(navCatalogEmpty ? 'ui.cmd.noNavConfigured' : 'ui.cmd.noMatches')}
      closeLabel={tc('ui.action.close')}
    />
  );
}
