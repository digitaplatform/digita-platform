import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { cn } from '../lib/cn.js';
import { Popover } from './Popover.js';

/**
 * Token-styled single-select. Hand-rolled (no Radix) to keep this package
 * dependency-light, matching the other primitives. Full keyboard a11y:
 * Arrow/Home/End navigation, Enter/Space to choose, Escape/Tab to close,
 * type-ahead, and the ARIA combobox + listbox + active-descendant pattern.
 * `searchable` adds a filter input inside the menu for long lists — while open
 * the input is the sole combobox and the trigger is a plain button. Light/dark +
 * compact come for free via tokens; the trigger mirrors the Input chrome.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type Size = 'sm' | 'md';

/** Trigger chrome per size — the menu stays one density regardless. */
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2 text-xs',
  md: 'px-3 py-2.5 text-sm',
};

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Trigger text when the value matches no option. */
  placeholder?: string;
  /** Show a filter input inside the menu — for long option lists. */
  searchable?: boolean;
  /** Placeholder for the filter input (localized by the caller). */
  searchPlaceholder?: string;
  /** Shown when the filter matches nothing (localized by the caller). */
  noResultsLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Trigger density: 'sm' = compact (h-8 / text-xs) for dense side panels. */
  size?: Size;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
  /** Optional field label rendered above the trigger. */
  label?: string;
  /** Class for the outer wrapper (e.g. a width). */
  wrapperClassName?: string;
}

function firstEnabled(options: SelectOption[]): number {
  return options.findIndex((o) => !o.disabled);
}
function lastEnabled(options: SelectOption[]): number {
  for (let i = options.length - 1; i >= 0; i--) if (!options[i]?.disabled) return i;
  return -1;
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  wrapperClassName,
  placeholder,
  searchable = false,
  searchPlaceholder,
  noResultsLabel,
  disabled = false,
  invalid = false,
  size = 'md',
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-required': ariaRequired,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef<{ q: string; t: number }>({ q: '', t: 0 });
  const baseId = useId();
  const listId = `${baseId}-list`;

  // The selected label comes from the FULL list; navigation runs over the
  // currently-visible (optionally filtered) `view`.
  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const view = useMemo(() => {
    if (!searchable || !filter.trim()) return options;
    const q = filter.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, searchable, filter]);

  const optionId = (i: number) => `${baseId}-opt-${i}`;
  // Clamped at render time so it can never reference a row outside the current view.
  const activeOptionId = open && activeIndex >= 0 && activeIndex < view.length ? optionId(activeIndex) : undefined;

  const openMenu = useCallback(() => {
    if (disabled) return;
    setFilter('');
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled(options));
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const closeMenu = useCallback((focusTrigger = true) => {
    setOpen(false);
    setActiveIndex(-1);
    setFilter('');
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (i: number) => {
      const opt = view[i];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      closeMenu();
    },
    [view, onChange, closeMenu],
  );

  // Close when a click lands outside the component (single canonical close
  // path). The list panel is PORTALED (Popover) — clicks inside it must not
  // count as outside, hence the panelRef check next to rootRef.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      closeMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, closeMenu]);

  // Move focus to the filter input when a searchable menu opens.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    (listRef.current?.children[activeIndex] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // If the visible set shrank (filtering), keep activeIndex on a live row.
  useEffect(() => {
    if (!open) return;
    setActiveIndex((cur) => (cur >= view.length ? firstEnabled(view) : cur));
  }, [open, view]);

  const move = (dir: 1 | -1) => {
    setActiveIndex((cur) => {
      const n = view.length;
      if (n === 0) return -1;
      let i = cur < 0 ? (dir === 1 ? -1 : 0) : cur;
      for (let step = 0; step < n; step++) {
        i = (i + dir + n) % n;
        if (!view[i]?.disabled) return i;
      }
      return cur;
    });
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    // Open + focus on the trigger → non-searchable path (searchable moves focus
    // into the filter input, which owns the keys instead).
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); setActiveIndex(firstEnabled(view)); break;
      case 'End': e.preventDefault(); setActiveIndex(lastEnabled(view)); break;
      case 'Enter':
      case ' ': e.preventDefault(); if (activeIndex >= 0) choose(activeIndex); break;
      case 'Escape': e.preventDefault(); closeMenu(); break;
      case 'Tab': closeMenu(false); break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          const q = now - typeahead.current.t < 600 ? typeahead.current.q + e.key : e.key;
          typeahead.current = { q, t: now };
          const lower = q.toLowerCase();
          const idx = view.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(lower));
          if (idx >= 0) setActiveIndex(idx);
        }
    }
  };

  // Filter input: arrows/enter/escape/tab drive the list; everything else edits text.
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Enter': e.preventDefault(); if (activeIndex >= 0) choose(activeIndex); break;
      case 'Escape': e.preventDefault(); closeMenu(); break;
      case 'Tab': e.preventDefault(); closeMenu(true); break; // return focus to the trigger, don't skip it
    }
  };

  const list = (
    <ul
      ref={listRef}
      data-ui="listbox"
      id={listId}
      role="listbox"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby ?? id}
      className="max-h-60 overflow-auto py-1"
    >
      {view.map((o, i) => {
        const isSelected = o.value === value;
        const isActive = i === activeIndex;
        return (
          <li
            key={o.value}
            data-ui="option"
            data-selected={isSelected || undefined}
            id={optionId(i)}
            role="option"
            aria-selected={isSelected}
            aria-disabled={o.disabled || undefined}
            onMouseEnter={() => !o.disabled && setActiveIndex(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm text-textMain',
              o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              isActive && 'bg-bgHover',
              isSelected && 'font-medium',
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-primary-600">
              {isSelected && <CheckIcon className="h-4 w-4" />}
            </span>
            <span className="truncate">{o.label}</span>
          </li>
        );
      })}
      {view.length === 0 && (
        <li role="presentation" className="px-3 py-2 text-sm text-textMuted">
          {noResultsLabel ?? '—'}
        </li>
      )}
    </ul>
  );

  return (
    <div className={cn(label ? 'flex flex-col gap-1.5' : wrapperClassName ? '' : 'contents', wrapperClassName)}>
      {label && (
        <label htmlFor={id} data-ui="field-label" className="text-xs font-medium text-textMuted">
          {label}
        </label>
      )}
      <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        data-ui="select-trigger"
        type="button"
        id={id}
        name={name}
        // While searchable + open the filter input is the combobox; keep the trigger a
        // plain button to avoid two comboboxes owning one listbox.
        role={searchable ? undefined : 'combobox'}
        aria-haspopup={searchable ? undefined : 'listbox'}
        aria-expanded={searchable ? undefined : open}
        aria-controls={!searchable && open ? listId : undefined}
        aria-activedescendant={searchable ? undefined : activeOptionId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-required={ariaRequired}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-input border bg-surface text-left',
          SIZES[size],
          'transition duration-base ease-smooth focus:shadow-focus focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-error focus:border-error' : 'border-border focus:border-primary-400',
        )}
      >
        <span className={cn('truncate', selected ? 'text-textMain' : 'text-neutral-400')}>
          {selected ? selected.label : (placeholder ?? '')}
        </span>
        <ChevronIcon
          className={cn('h-4 w-4 shrink-0 text-textMuted transition-transform duration-base', open && 'rotate-180')}
        />
      </button>

      {/* Portaled via Popover: the options can never be clipped by an
          overflow container (dialog bodies, grid cells). Select keeps its OWN
          Escape/outside handling — its keydown handlers preventDefault, which
          is the contract BaseDialog needs to stay open. */}
      <Popover
        open={open}
        anchorRef={rootRef}
        onRequestClose={() => closeMenu(false)}
        matchAnchorWidth
        closeOnEscape={false}
        closeOnOutsidePointer={false}
      >
        <div ref={panelRef}>
          {searchable && (
            <div className="border-b border-border p-1.5">
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={activeOptionId}
                aria-autocomplete="list"
                aria-label={searchPlaceholder ?? ariaLabel}
                placeholder={searchPlaceholder}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setActiveIndex(0); // re-anchor the highlight to the first match on each keystroke
                }}
                onKeyDown={onSearchKeyDown}
                className="w-full rounded-input border border-border bg-transparent px-2.5 py-1.5 text-sm text-textMain placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none"
              />
            </div>
          )}
          {list}
        </div>
      </Popover>
      </div>
    </div>
  );
}
