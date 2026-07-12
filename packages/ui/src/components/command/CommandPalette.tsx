import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { useNavigableCatalog } from '@/hooks/useNavigableCatalog';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { CommandPaletteView } from './CommandPaletteView';
import {
  buildCommandItems,
  filterCommandItems,
  type CommandItem,
} from './use-command-items';
import type { GlobalSearchResult } from '@/services/search';

/**
 * The CommandPalette HOST (the one stateful exception to the pure-component
 * rule for this group). Owns every hook — ui store open/close, the navigable
 * catalog, debounced global search, session roles, the router, and the local
 * query + activeIndex + keyboard machine — builds the items via the pure
 * use-command-items helpers, and renders the pure CommandPaletteView.
 *
 * Mounted ONCE by ShellRenderer (universal chrome). The Cmd/Ctrl-K hotkey is
 * registered by the shell; this component reacts to the ui store's
 * commandPaletteOpen flag.
 */

const SEARCH_DEBOUNCE_MS = 180;

/** Resolvable record hit → router path (mirrors the View's filter). */
function hitTo(hit: GlobalSearchResult): string | null {
  const entity = (hit.entity || hit.doctype) as string | undefined;
  const name = (hit.name || hit._id) as string | undefined;
  if (!entity || !name) return null;
  return `/${entity}/${name}`;
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
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  const search = useGlobalSearch(open ? debounced : '');

  // Reset query + selection each time the palette opens (fresh start).
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setActiveIndex(0);
    }
  }, [open]);

  // Build nav items (memoized on catalog + roles + locale), then client-filter.
  const allItems = useMemo<CommandItem[]>(
    () =>
      buildCommandItems({
        navigable,
        entityLabel: (entity, fallback) => tEntity(entity, fallback),
        tc,
        hasRole,
      }),
    [navigable, tEntity, tc, hasRole],
  );

  const items = useMemo(() => filterCommandItems(allItems, query), [allItems, query]);

  // The record hits that resolve to a route (must match the View's records list).
  const records = useMemo<GlobalSearchResult[]>(
    () => (search.data ?? []).filter((h) => hitTo(h) !== null),
    [search.data],
  );

  const searchActive = query.trim().length >= 2;
  // Memoized so the empty-case `[]` keeps a stable identity across renders
  // (else selectAt's useCallback deps churn every render).
  const visibleRecords = useMemo(() => (searchActive ? records : []), [searchActive, records]);
  const flatCount = items.length + visibleRecords.length;

  // Clamp the active index whenever the flat list shrinks (e.g. query narrows).
  useEffect(() => {
    setActiveIndex((i) => {
      if (flatCount === 0) return 0;
      return Math.min(i, flatCount - 1);
    });
  }, [flatCount]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const selectAt = useCallback(
    (index: number) => {
      let to: string | null;
      if (index < items.length) {
        to = items[index]?.to ?? null;
      } else {
        const hit = visibleRecords[index - items.length];
        to = hit ? hitTo(hit) : null;
      }
      if (!to) return;
      close();
      navigate(to);
    },
    [items, visibleRecords, navigate, close],
  );

  // Keyboard machine (Arrow/Enter/Escape). Bound at the window so it works
  // regardless of which inner element holds focus while the palette is open.
  const stateRef = useRef({ flatCount, activeIndex });
  stateRef.current = { flatCount, activeIndex };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const { flatCount: count } = stateRef.current;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (count === 0 ? 0 : (i + 1) % count));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (count === 0 ? 0 : (i - 1 + count) % count));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(count === 0 ? 0 : count - 1);
          break;
        case 'Enter':
          e.preventDefault();
          selectAt(stateRef.current.activeIndex);
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, selectAt, close]);

  return (
    <CommandPaletteView
      open={open}
      query={query}
      onQuery={setQuery}
      items={items}
      searchResults={search.data ?? []}
      loading={searchActive && (search.isFetching || search.isLoading)}
      error={searchActive && search.isError}
      activeIndex={activeIndex}
      onActiveIndex={setActiveIndex}
      onSelect={selectAt}
      onClose={close}
      navCatalogEmpty={!catalogLoading && navigable.length === 0}
    />
  );
}
