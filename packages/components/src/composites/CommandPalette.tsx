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

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandPaletteItem[];
  /** Fires on Enter / click; the HOST decides what to do (navigate, close, …). */
  onSelect: (item: CommandPaletteItem) => void;
  placeholder?: string;
  /** Accessible dialog name. */
  'aria-label'?: string;
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
 * skipped), Enter selects, Escape closes (respecting `defaultPrevented`, so a
 * capture-phase consumer like an open Popover wins). Mobile <sm is a full-screen
 * sheet with a pinned input; >=sm a centered floating panel.
 */
export function CommandPalette({
  open,
  onClose,
  items,
  onSelect,
  placeholder = 'Type a command or search…',
  'aria-label': ariaLabel = 'Command palette',
  emptyText = 'No results',
  closeLabel = 'Close',
  className,
}: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q.length === 0
        ? items
        : items.filter((it) =>
            [it.label, it.sublabel, it.group, it.keywords].some((s) => s?.toLowerCase().includes(q)),
          ),
    [items, q],
  );

  const [active, setActive] = useState(-1);

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

  // (Re)seat the highlight on the first enabled row whenever the list changes.
  useEffect(() => {
    setActive(filtered.findIndex((it) => !it.disabled));
  }, [filtered, open]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const move = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    let i = active < 0 ? (dir === 1 ? -1 : 0) : active;
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
    } else if (e.key === 'Enter') {
      const it = active >= 0 ? filtered[active] : undefined;
      if (it && !it.disabled) {
        e.preventDefault();
        onSelect(it);
      }
    }
  };

  if (!open || typeof document === 'undefined') return null;

  // One flat pass: a heading is emitted whenever the (defined) group changes.
  const rows: ReactNode[] = [];
  let lastGroup: string | undefined;
  filtered.forEach((item, i) => {
    if (item.group && item.group !== lastGroup) {
      rows.push(
        <li key={`group:${item.group}:${i}`} role="presentation">
          <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-textMuted">
            {item.group}
          </div>
        </li>,
      );
    }
    lastGroup = item.group;
    const isActive = i === active;
    rows.push(
      <li
        key={item.id}
        id={optionId(i)}
        data-index={i}
        data-ui="command-item"
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
        {item.shortcut && (
          <kbd className="shrink-0 rounded border border-border bg-subtle px-1 font-sans text-micro text-textMuted">
            {item.shortcut}
          </kbd>
        )}
      </li>,
    );
  });

  return createPortal(
    <div
      data-ui="command-overlay"
      className="fixed inset-0 z-dialog flex items-stretch justify-center bg-[color:var(--color-scrim,rgba(0,0,0,0.30))] backdrop-blur-sm sm:items-start sm:pt-[12vh]"
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
          aria-label={ariaLabel}
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {rows}
          {filtered.length === 0 && (
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
      </div>
    </div>,
    document.body,
  );
}
