import { useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ArrowRight, AlertTriangle } from 'lucide-react';
import { Spinner, cn } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useFocusTrap } from '@/lib/use-focus-trap';
import type { CommandItem } from './use-command-items';
import type { GlobalSearchResult } from '@/services/search';

/**
 * PURE command-palette overlay. Props in, callbacks up — no hooks that fetch,
 * no store reads. The host (CommandPalette.tsx) owns query/activeIndex/keyboard
 * state and the data; this only renders. Mounted at <body> via a portal (the
 * DialogHost idiom) so it escapes the shell overflow; a Tab focus-trap keeps
 * keyboarding inside while open.
 *
 * Layout is one flat selectable list (nav items first, then a "Records" group
 * from searchResults) so the host can drive a single linear activeIndex with
 * Arrow keys. Mobile (<sm) is a full-screen sheet with a pinned input + a
 * visible close button; >=sm is a centered floating panel.
 */

export interface CommandPaletteViewProps {
  open: boolean;
  query: string;
  onQuery: (q: string) => void;
  /** Nav items (already filtered by the host's client substring filter). */
  items: CommandItem[];
  /** Global record-search hits for the current query. */
  searchResults: GlobalSearchResult[];
  /** Search request in flight (>= 2 chars). */
  loading: boolean;
  /** Search transport failure — rendered as a loud inline row, never swallowed. */
  error: boolean;
  /** Host-driven highlight, indexing the flat [nav…, records…] order. */
  activeIndex: number;
  onActiveIndex: (i: number) => void;
  /** Select the row at `index` in the flat order. */
  onSelect: (index: number) => void;
  onClose: () => void;
  /** True when the navigable catalog is empty (distinct "no nav configured"). */
  navCatalogEmpty: boolean;
}

const LISTBOX_ID = 'command-palette-listbox';
const optionId = (i: number): string => `command-option-${i}`;

/** Best-effort display label for a search hit (loud-tolerant, never blank). */
function hitLabel(hit: GlobalSearchResult): string {
  return (hit.title || hit.display || hit.name || hit._id || '—') as string;
}
function hitEntity(hit: GlobalSearchResult): string | undefined {
  return (hit.entity || hit.doctype) as string | undefined;
}
function hitTo(hit: GlobalSearchResult): string | null {
  const entity = hitEntity(hit);
  const name = (hit.name || hit._id) as string | undefined;
  if (!entity || !name) return null;
  return `/${entity}/${name}`;
}

export function CommandPaletteView({
  open,
  query,
  onQuery,
  items,
  searchResults,
  loading,
  error,
  activeIndex,
  onActiveIndex,
  onSelect,
  onClose,
  navCatalogEmpty,
}: CommandPaletteViewProps) {
  const tc = useChrome();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useFocusTrap(panelRef, open);

  // Steal initial focus to the input on open (the trap focuses the first
  // focusable; the input is what the user wants to type into immediately).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the active row scrolled into view as the host moves activeIndex.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex))}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  // Flat order: nav items first, then resolvable record hits (must match the
  // host's index math — both derive from these same two arrays).
  const records = useMemo(() => searchResults.filter((h) => hitTo(h) !== null), [searchResults]);
  const navCount = items.length;

  if (!open) return null;

  const showQuery = query.trim().length > 0;
  const searchActive = query.trim().length >= 2;
  const nothingAtAll =
    items.length === 0 && records.length === 0 && !loading && !error;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/30 backdrop-blur-sm sm:items-start sm:pt-[12vh]"
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the panel don't bubble here.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={tc('ui.cmd.title')}
        className={cn(
          // The flagship surface carries the signature glass language.
          'anim-pop-in flex w-full flex-col overflow-hidden bg-surfaceGlass shadow-lg backdrop-blur-md',
          'h-full sm:h-auto sm:max-h-[70vh] sm:w-[40rem] sm:max-w-[92vw] sm:rounded-dialog sm:border sm:border-border',
        )}
      >
        {/* Pinned input row */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-5 w-5 shrink-0 text-textMuted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={LISTBOX_ID}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={tc('ui.cmd.placeholder')}
            className="w-full bg-transparent text-sm text-textMain placeholder:text-textMuted focus:outline-none"
          />
          {loading && <Spinner className="h-4 w-4 shrink-0 text-textMuted" />}
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('ui.action.close')}
            className="shrink-0 rounded p-1 text-textMuted hover:bg-bgHover focus-visible:shadow-focus focus-visible:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id={LISTBOX_ID}
          role="listbox"
          aria-label={tc('ui.cmd.resultsLabel')}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {/* Nav group */}
          {items.length > 0 && (
            <li role="presentation">
              <GroupHeading text={tc('ui.cmd.navGroup')} />
            </li>
          )}
          {items.map((item, i) => (
            <Row
              key={item.id}
              id={optionId(i)}
              active={i === activeIndex}
              onActivate={() => onActiveIndex(i)}
              onSelect={() => onSelect(i)}
              label={item.label}
              sublabel={item.sublabel}
            />
          ))}

          {/* Records group */}
          {searchActive && (
            <li role="presentation">
              <GroupHeading text={tc('ui.cmd.recordsGroup')} />
            </li>
          )}
          {error && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-error"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tc('ui.cmd.searchError')}</span>
            </li>
          )}
          {searchActive &&
            !error &&
            records.map((hit, j) => {
              const flatIndex = navCount + j;
              const entity = hitEntity(hit);
              return (
                <Row
                  key={`rec:${entity ?? '?'}:${(hit.name ?? hit._id) as string}`}
                  id={optionId(flatIndex)}
                  active={flatIndex === activeIndex}
                  onActivate={() => onActiveIndex(flatIndex)}
                  onSelect={() => onSelect(flatIndex)}
                  label={hitLabel(hit)}
                  sublabel={entity}
                  showArrow
                />
              );
            })}
          {searchActive && !error && !loading && records.length === 0 && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-4 py-2.5 text-sm text-textMuted"
            >
              {tc('ui.cmd.noRecords')}
            </li>
          )}

          {/* Distinct empties */}
          {navCatalogEmpty && items.length === 0 && showQuery && !searchActive && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-4 py-6 text-center text-sm text-textMuted"
            >
              {tc('ui.cmd.noNavConfigured')}
            </li>
          )}
          {nothingAtAll && showQuery && !navCatalogEmpty && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-4 py-6 text-center text-sm text-textMuted"
            >
              {tc('ui.cmd.noMatches')}
            </li>
          )}
          {!showQuery && items.length === 0 && navCatalogEmpty && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-4 py-6 text-center text-sm text-textMuted"
            >
              {tc('ui.cmd.noNavConfigured')}
            </li>
          )}
        </ul>

        {/* Footer hint (desktop only — phones have no Cmd-K affordance) */}
        <div className="hidden shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-textMuted sm:flex">
          <KeyHint k="↑↓" label={tc('ui.cmd.hintNavigate')} />
          <KeyHint k="↵" label={tc('ui.cmd.hintSelect')} />
          <KeyHint k="esc" label={tc('ui.cmd.hintClose')} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GroupHeading({ text }: { text: string }) {
  return (
    <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-textMuted">
      {text}
    </div>
  );
}

function Row({
  id,
  active,
  onActivate,
  onSelect,
  label,
  sublabel,
  showArrow,
}: {
  id: string;
  active: boolean;
  onActivate: () => void;
  onSelect: () => void;
  label: string;
  sublabel?: string;
  showArrow?: boolean;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onActivate}
      onMouseDown={(e) => {
        // mousedown (not click) so the input keeps focus for keyboard fallback
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors duration-fast',
        active ? 'bg-bgHover text-textMain' : 'text-textMain',
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {sublabel && <span className="truncate text-xs text-textMuted">{sublabel}</span>}
      </span>
      {showArrow && <ArrowRight className="h-4 w-4 shrink-0 text-textMuted" aria-hidden="true" />}
    </li>
  );
}

function KeyHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-border bg-subtle px-1 font-sans text-micro text-textMuted">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
