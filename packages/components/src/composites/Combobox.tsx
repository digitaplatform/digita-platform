import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { cn } from '../lib/cn.js';
import { Input } from '../primitives/Input.js';
import { Popover } from '../primitives/Popover.js';

export interface ComboboxOption {
  id: string;
  label: string;
  /** Secondary line (e.g. sub-row parent title). */
  subtitle?: string;
}

export interface ComboboxProps {
  id?: string;
  /** Display text while the popup is CLOSED (the stored value's label). */
  value: string;
  /** Controlled search text while the popup is OPEN. */
  query: string;
  onQueryChange: (q: string) => void;
  options: ComboboxOption[];
  loading?: boolean;
  /** Popup state is owned by the caller (it gates the async search). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Take-over: Enter/Tab on the highlight or click on an option. */
  onPick: (opt: ComboboxOption) => void;
  placeholder?: string;
  loadingLabel?: string;
  emptyLabel?: string;
  invalid?: boolean;
  required?: boolean;
  ariaLabel?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  /** Renders a clear (×) affordance when value is present. */
  onClear?: () => void;
  clearLabel?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/**
 * THE async search combobox (ARIA 1.2 pattern) — the single implementation
 * behind every Link typeahead (form LinkControl, list Link filters). The
 * listbox renders through [[Popover]] (portaled — never clipped, e.g. inside
 * the DataGrid body) and the keyboard contract follows the app's data-entry
 * convention:
 *   ArrowDown/Up  open + move the highlight (clamped, scrolled into view)
 *   Enter         picks the highlight; ALWAYS preventDefault while focused —
 *                 even with an empty/loading list — so a form's implicit
 *                 submit can never fire mid-lookup
 *   Tab           picks the highlight (popup open), then focus moves on
 *                 naturally (fast keyboard entry)
 *   Escape        closes ONLY the popup (consumed via Popover contract);
 *                 the field keeps focus
 * The highlight resets on query changes, NOT on options array identity, so a
 * background re-render can't snap the selection back to the top.
 */
export function Combobox({
  id,
  value,
  query,
  onQueryChange,
  options,
  loading,
  open,
  onOpenChange,
  onPick,
  placeholder,
  loadingLabel = 'Searching…',
  emptyLabel = 'No results',
  invalid,
  required,
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  onClear,
  clearLabel = 'Clear',
  inputRef,
  className,
}: ComboboxProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const listboxId = `${controlId}-listbox`;
  const anchorRef = useRef<HTMLDivElement>(null);
  // -1 = no highlight (APG: opening does not pre-select; the first ArrowDown
  // moves onto the first option).
  const [activeIndex, setActiveIndex] = useState(-1);
  // Hover may only move the highlight AFTER a genuine pointer movement. A list
  // re-rendering under a stationary cursor (debounced results landing) fires a
  // stray mouseenter that must NOT hijack the keyboard selection and commit the
  // wrong record on Tab/Enter (mirrors SearchDialog's guard).
  const pointerMoved = useRef(false);

  // Reset the highlight when the SEARCH changes — not when the options array
  // gets a new identity from a background re-render.
  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  // A fresh result set arrived: ignore stray hover until the pointer truly
  // moves again. Keyed by option ids (content), not array identity.
  const optionsKey = options.map((o) => o.id).join(' ');
  useEffect(() => {
    pointerMoved.current = false;
  }, [optionsKey]);

  // Keep the highlight scrolled into view during arrow navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${controlId}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, controlId]);

  const highlighted = open && activeIndex >= 0 ? options[activeIndex] : undefined;

  const pick = (opt: ComboboxOption) => {
    onPick(opt);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      pointerMoved.current = false; // keyboard takes over; ignore stray hover
      if (!open) onOpenChange(true);
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      pointerMoved.current = false;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // ALWAYS consumed: an Enter mid-lookup must never reach the form.
      e.preventDefault();
      if (highlighted) pick(highlighted);
    } else if (e.key === 'Tab') {
      // Commit-and-move: take the highlight, let focus travel naturally.
      if (highlighted) pick(highlighted);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
      }
    }
  };

  return (
    <div ref={anchorRef} className={cn('relative', className)}>
      <Input
        ref={inputRef}
        id={controlId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={highlighted ? `${controlId}-opt-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={open ? query : value}
        onFocus={() => {
          if (!open) {
            onOpenChange(true);
            onQueryChange('');
            setActiveIndex(-1);
          }
        }}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={onClear && value ? 'pr-8' : undefined}
      />
      {onClear && value && (
        <button
          type="button"
          aria-label={clearLabel}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain"
        >
          ×
        </button>
      )}
      <Popover open={open} anchorRef={anchorRef} onRequestClose={() => onOpenChange(false)} matchAnchorWidth>
        <ul
          id={listboxId}
          role="listbox"
          className="max-h-64 overflow-auto"
          onMouseMove={() => {
            pointerMoved.current = true;
          }}
        >
          {loading && (
            <li role="presentation" className="px-3 py-2 text-sm text-textMuted">
              {loadingLabel}
            </li>
          )}
          {!loading && options.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm text-textMuted">
              {emptyLabel}
            </li>
          )}
          {!loading &&
            options.map((opt, i) => (
              <li key={opt.id} role="presentation">
                <button
                  type="button"
                  id={`${controlId}-opt-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => {
                    if (pointerMoved.current) setActiveIndex(i);
                  }}
                  onClick={() => pick(opt)}
                  className={cn(
                    'block w-full px-3 py-2 text-left text-sm transition-colors duration-base ease-smooth',
                    i === activeIndex ? 'bg-bgHover' : '',
                  )}
                >
                  <span className="text-textMain">{opt.label}</span>
                  {opt.subtitle && <span className="ml-2 text-xs text-textMuted">{opt.subtitle}</span>}
                </button>
              </li>
            ))}
        </ul>
      </Popover>
    </div>
  );
}
