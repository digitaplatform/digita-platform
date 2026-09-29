import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';
import { useFocusTrap } from '../lib/use-focus-trap.js';

export interface CommandPaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  /** Group heading text — consecutive items sharing a group render under ONE
   *  heading (order the items array by group). */
  group?: string;
  icon?: ReactNode;
  /** Display-only shortcut hint (e.g. "Ctrl+K") rendered as a <kbd> chip. */
  shortcut?: string;
  /** Extra text the filter matches besides label/sublabel/group. */
  keywords?: string;
  disabled?: boolean;
}

export interface CommandPaletteHints {
  navigate: string;
  select: string;
  close: string;
}

export interface CommandPaletteProps<T extends CommandPaletteItem = CommandPaletteItem> {
  open: boolean;
  onClose: () => void;
  items: T[];
  /** Fires on Enter / click; the HOST decides what to do (navigate, close, …). */
  onSelect: (item: T) => void;
  /** Controlled query. When set, the host owns the filter too: the items arrive
   *  already narrowed (an async search cannot be re-filtered by substring). */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Controlled highlight: an index into the visible rows, which are `items` narrowed by the
   *  substring filter, or `items` as handed over when the query is controlled. */
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
  /** Row under the items for what is not an item: a search in flight, a failed
   *  search, an async group that came back empty. It replaces the empty row. */
  status?: ReactNode;
  /** Group heading over the status row, so a reader knows which group the status is about. */
  statusGroup?: string;
  /** Labels of the footer's key hints. */
  hints?: CommandPaletteHints;
  placeholder?: string;
  /** Accessible dialog name. */
  'aria-label'?: string;
  /** Accessible name of the result list; a screen reader announces it after the dialog name. */
  listLabel?: string;
  /** Row shown when the filter matches nothing. */
  emptyText?: string;
  closeLabel?: string;
  className?: string;
}

/**
 * Generic command palette — props in, callbacks out (no fetching, no store
 * reads; the host owns the item list and what selection means). Overlay follows
 * the BaseDialog idiom: portal to <body>, tokenized scrim, anim-pop-in panel,
 * self-contained focus trap (kit-internal useFocusTrap), focus restored to the
 * opener on close. Keyboard: type-to-filter, ArrowUp/Down move (disabled rows
 * skipped), Home/End jump, Enter selects, Escape closes (respecting
 * `defaultPrevented`, so a capture-phase consumer like an open Popover wins).
 * Mobile <sm is a full-screen sheet with a pinned input; >=sm a centered
 * floating panel. The query and the highlight are controlled when the host
 * passes them, so an async host can own the filter and read the active row.
 */
export function CommandPalette<T extends CommandPaletteItem>({
  open,
  onClose,
  items,
  onSelect,
  query: queryProp,
  onQueryChange,
  activeIndex: activeProp,
  onActiveIndexChange,
  status,
  statusGroup,
  hints = { navigate: 'navigate', select: 'select', close: 'close' },
  placeholder = 'Type a command or search…',
  'aria-label': ariaLabel = 'Command palette',
  listLabel = 'Results',
  emptyText = 'No results',
  closeLabel = 'Close',
  className,
}: CommandPaletteProps<T>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  const [queryState, setQueryState] = useState('');
  const query = queryProp ?? queryState;
  const setQuery = (value: string) => {
    // A new query starts at the top; the highlighted row is only kept across list changes.
    activeIdRef.current = undefined;
    setQueryState(value);
    onQueryChange?.(value);
  };
  const q = queryProp === undefined ? query.trim().toLowerCase() : '';
  const filtered = useMemo(
    () =>
      q.length === 0
        ? items
        : items.filter((it) =>
            [it.label, it.sublabel, it.group, it.keywords].some((s) => s?.toLowerCase().includes(q)),
          ),
    [items, q],
  );

  const [activeState, setActiveState] = useState(-1);
  const active = activeProp ?? activeState;
  // The highlighted row by id, so a list that changes under the same query (an async host
  // handing over its hits) keeps the operator's arrow position instead of the index.
  const activeIdRef = useRef<string | undefined>(undefined);
  const setActive = (index: number) => {
    activeIdRef.current = filtered[index]?.id;
    setActiveState(index);
    onActiveIndexChange?.(index);
  };

  useFocusTrap(panelRef, open);

  // Fresh palette per open: clear the filter (active resets via the effect below).
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Steal initial focus to the input (the trap focuses the first focusable; the
  // input is what the user wants to type into immediately).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Seat the highlight whenever the list changes: on the row highlighted before while it is
  // still there, else on the first enabled row.
  useEffect(() => {
    const kept = filtered.findIndex((it) => it.id === activeIdRef.current);
    setActive(kept >= 0 ? kept : filtered.findIndex((it) => !it.disabled));
  }, [filtered, open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const move = (dir: 1 | -1, from = active) => {
    if (filtered.length === 0) return;
    let i = from < 0 ? (dir === 1 ? -1 : 0) : from;
    for (let step = 0; step < filtered.length; step++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (!filtered[i]!.disabled) {
        setActive(i);
        return;
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // A capture-phase consumer already used this Escape to close itself.
      if (e.defaultPrevented) return;
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(1, -1);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(-1, 0);
    } else if (e.key === 'Enter') {
      const it = active >= 0 ? filtered[active] : undefined;
      if (it && !it.disabled) {
        e.preventDefault();
        onSelect(it);
      }
    }
  };

  if (!open || typeof document === 'undefined') return null;

  // One flat pass: a heading is emitted whenever the (defined) group changes, the status row
  // included, so a status about a group that has rows does not repeat its heading.
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  const pushGroup = (group: string, key: string) => {
    rows.push(
      <li key={key} role="presentation">
        <div
          data-ui="command-group"
          className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-textMuted"
        >
          {group}
        </div>
      </li>,
    );
  };
  filtered.forEach((item, i) => {
    if (item.group && item.group !== lastGroup) pushGroup(item.group, `group:${item.group}:${i}`);
    lastGroup = item.group;
    const isActive = i === active;
    rows.push(
      <li
        key={item.id}
        id={optionId(i)}
        data-index={i}
        data-ui="command-item"
        data-active={isActive || undefined}
        role="option"
        aria-selected={isActive}
        aria-disabled={item.disabled || undefined}
        onMouseMove={() => {
          if (!item.disabled && active !== i) setActive(i);
        }}
        onMouseDown={(e) => {
          // mousedown (not click) so the input keeps focus for keyboard fallback
          e.preventDefault();
          if (!item.disabled) onSelect(item);
        }}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 text-sm text-textMain transition-colors duration-fast',
          isActive && 'bg-bgHover',
          item.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        )}
      >
        {item.icon && (
          <span data-ui="command-icon" aria-hidden="true" className="shrink-0 text-textMuted">
            {item.icon}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.label}</span>
          {item.sublabel && <span className="truncate text-xs text-textMuted">{item.sublabel}</span>}
        </span>
        {item.shortcut && <Kbd className="shrink-0">{item.shortcut}</Kbd>}
      </li>,
    );
  });
  if (status != null && statusGroup && statusGroup !== lastGroup) pushGroup(statusGroup, 'group:status');

  return createPortal(
    <div
      data-ui="command-overlay"
      className="fixed inset-0 z-dialog flex items-stretch justify-center bg-scrim backdrop-blur-sm sm:items-start sm:pt-[12vh]"
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the panel don't bubble here.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-ui="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'anim-pop-in flex w-full flex-col overflow-hidden bg-surfaceGlass shadow-lg outline-none backdrop-blur-md',
          'h-full sm:h-auto sm:max-h-[70vh] sm:w-[40rem] sm:max-w-[92vw] sm:rounded-dialog sm:border sm:border-border',
          className,
        )}
      >
        {/* Pinned input row */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-textMuted">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            data-ui="command-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm text-textMain placeholder:text-textMuted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="shrink-0 rounded p-1 text-textMuted transition-colors duration-base hover:bg-bgHover hover:text-textMain focus-visible:shadow-focus focus-visible:outline-none"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={listLabel}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {rows}
          {status != null && (
            <li role="presentation" data-ui="command-status" className="px-4 py-2.5 text-sm text-textMuted">
              {status}
            </li>
          )}
          {filtered.length === 0 && status == null && (
            <li
              role="option"
              aria-selected={false}
              aria-disabled="true"
              className="px-4 py-6 text-center text-sm text-textMuted"
            >
              {emptyText}
            </li>
          )}
        </ul>

        {/* Key hints: desktop only, a phone has no keyboard to hint at. */}
        <div
          data-ui="command-footer"
          className="hidden shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-textMuted sm:flex"
        >
          <span className="flex items-center gap-1">
            <Kbd>↑↓</Kbd>
            <span>{hints.navigate}</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            <span>{hints.select}</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd>
            <span>{hints.close}</span>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd
      data-ui="command-kbd"
      className={cn('rounded border border-border bg-subtle px-1 font-sans text-micro text-textMuted', className)}
    >
      {children}
    </kbd>
  );
}
