import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { cn } from '../lib/cn.js';
import { Popover } from '../primitives/Popover.js';

/**
 * NORDSTERN F8 — REFERENCE IMPLEMENTATION (adapt imports/types to the kit).
 *
 * Themed date picker replacing <input type="date"> (native chrome can never
 * match a design, least of all iOS). A trigger styled like a field opens a
 * popover calendar (Popover primitive → inherits every design's radius/glass/
 * shadow; the variant layers restyle day cells via .dg-datepicker hooks).
 *
 * iOS "compact" fast navigation: the month/year title is tappable and flips
 * the day grid into a month + year selection; the chevrons then page years
 * ×12 — a birthdate is 3 taps away. For birthdate-class fields consider a
 * wheels presentation behind a field metadata hint (display_hint:"birthdate").
 *
 * Keyboard: opening puts the focus on the selected day (today without one). The arrow keys move it
 * a day or a week, Home and End to the ends of the week, PageUp and PageDown a month (with Shift a
 * year), across the edges of the month; Enter picks. Tab and Shift+Tab wrap inside the open panel,
 * except in a Table grid cell, whose editor takes Tab (not Shift+Tab) to commit the cell and move on.
 * A panel that held the focus hands it back to the trigger when it closes.
 *
 * Value contract: 'YYYY-MM-DD' string or undefined (matches DateControl).
 * Week starts Monday (format-locale follow-up: derive from Intl.Locale).
 */

export interface DatePickerProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  /** BCP-47 format locale from the boot session (e.g. 'de-CH'). */
  locale?: string;
  placeholder?: string;
  /** Text of the panel's action that empties a set date (emits `undefined`). */
  clearLabel?: string;
  /** Names of the two paging buttons; the caller owns the language, as it does for `clearLabel`. */
  previousLabel?: string;
  nextLabel?: string;
  /** Their names in the month and year view, where they page twelve years instead of a month. */
  previousYearsLabel?: string;
  nextYearsLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  /** The field label: it names the trigger and the calendar dialog. */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

interface Ymd { y: number; m: number; d: number }

function parseIso(v?: string): Ymd | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? { y: +m[1]!, m: +m[2]! - 1, d: +m[3]! } : null;
}
function toIso({ y, m, d }: Ymd): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(m + 1)}-${p(d)}`;
}
/** Steps through Date's own overflow into the next month or year: adding milliseconds is an hour off
 *  across a daylight-saving change. */
function addDays({ y, m, d }: Ymd, n: number): Ymd {
  const t = new Date(y, m, d + n);
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
}
/** The same day of the month `n` months on, or the last day of a month that is shorter. */
function addMonths({ y, m, d }: Ymd, n: number): Ymd {
  const first = new Date(y, m + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { y: first.getFullYear(), m: first.getMonth(), d: Math.min(d, last) };
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" />
    </svg>
  );
}
function Chevron({ className, dir }: { className?: string; dir: 'left' | 'right' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

const DAY_BTN =
  'dp-day flex min-h-8 items-center justify-center rounded-md text-sm text-textMain transition-colors duration-base ease-smooth hover:bg-bgHover disabled:pointer-events-none';
const SEL = 'bg-primary-600 font-semibold text-onPrimary hover:bg-primary-600';
const TODAY = 'font-semibold text-primaryText';

export function DatePicker({
  value,
  onChange,
  locale,
  placeholder,
  clearLabel = 'Clear',
  previousLabel = 'Previous',
  nextLabel = 'Next',
  previousYearsLabel = previousLabel,
  nextYearsLabel = nextLabel,
  disabled,
  invalid,
  id,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-required': ariaRequired,
}: DatePickerProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'my'>('days');
  const selected = useMemo(() => parseIso(value), [value]);
  const [my, setMy] = useState<{ y: number; m: number }>(() => {
    const s = selected ?? { y: new Date().getFullYear(), m: new Date().getMonth(), d: 1 };
    return { y: s.y, m: s.m };
  });
  const [yearBase, setYearBase] = useState(my.y - 7);
  // The day of the shown month that holds the focus, the one day in the tab order.
  const [focusDay, setFocusDay] = useState(() => selected?.d ?? new Date().getDate());
  // The day button that takes the focus is drawn by the render that follows, so the request waits
  // for it: on opening, after a key moved the day and after a month pick, on the first render and
  // not on any later one.
  const focusDayNext = useRef(false);
  useEffect(() => {
    if (!focusDayNext.current) return;
    focusDayNext.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  });

  const openPanel = useCallback(() => {
    const s = parseIso(value) ?? { y: new Date().getFullYear(), m: new Date().getMonth(), d: new Date().getDate() };
    setMy({ y: s.y, m: s.m });
    setFocusDay(s.d);
    setYearBase(s.y - 7);
    setView('days');
    focusDayNext.current = true;
    setOpen(true);
  }, [value]);

  // Closing removes the day button that holds the focus, and the focus would fall to the page. A
  // panel that held it hands it to the trigger; one that did not (a click outside) leaves it where
  // the person put it. Only this picker's own panel counts: Escape closes every open calendar, and
  // each one would otherwise send the focus to its own trigger.
  const close = () => {
    const holdsFocus = panelRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (holdsFocus) triggerRef.current?.focus();
  };
  const pick = (ymd: Ymd) => { onChange(toIso(ymd)); close(); };

  const display = selected
    ? new Date(selected.y, selected.m, selected.d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  const title = new Date(my.y, my.m, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekdays = useMemo(() => {
    // Monday-start localized two-letter weekday row, each named in full for a screen reader.
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(2024, 0, i + 1);
      return {
        short: date.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2),
        long: date.toLocaleDateString(locale, { weekday: 'long' }),
      };
    });
  }, [locale]);

  const off = (new Date(my.y, my.m, 1).getDay() + 6) % 7;
  const days = new Date(my.y, my.m + 1, 0).getDate();
  const now = new Date();

  const page = (dir: 1 | -1) => {
    if (view === 'my') { setYearBase((b) => b + dir * 12); return; }
    setMy(({ y, m }) => (m + dir < 0 ? { y: y - 1, m: 11 } : m + dir > 11 ? { y: y + 1, m: 0 } : { y, m: m + dir }));
  };

  // The focus day can lie past the end of a shorter month that the person paged to.
  const tabDay = Math.min(focusDay, days);
  const column = (off + tabDay - 1) % 7;
  const moveDay = (e: KeyboardEvent<HTMLDivElement>) => {
    // A key with a modifier belongs to the browser or the system: Alt+Left goes back a page.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at: Ymd = { y: my.y, m: my.m, d: tabDay };
    let to: Ymd;
    switch (e.key) {
      case 'ArrowLeft': to = addDays(at, -1); break;
      case 'ArrowRight': to = addDays(at, 1); break;
      case 'ArrowUp': to = addDays(at, -7); break;
      case 'ArrowDown': to = addDays(at, 7); break;
      case 'Home': to = addDays(at, -column); break;
      case 'End': to = addDays(at, 6 - column); break;
      case 'PageUp': to = addMonths(at, e.shiftKey ? -12 : -1); break;
      case 'PageDown': to = addMonths(at, e.shiftKey ? 12 : 1); break;
      default: return;
    }
    // These keys would scroll the page otherwise.
    e.preventDefault();
    setMy({ y: to.y, m: to.m });
    setFocusDay(to.d);
    focusDayNext.current = true;
  };

  // The panel is portaled to the end of the page, past the Tab trap of a dialog it opens from, so it
  // keeps Tab inside itself, as a modal dialog does.
  const keepTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const stops = e.currentTarget.querySelectorAll<HTMLElement>('button:not([tabindex="-1"])');
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (document.activeElement !== (e.shiftKey ? first : last)) return;
    e.preventDefault();
    (e.shiftKey ? last : first)?.focus();
  };

  return (
    <div ref={anchorRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-ui="select-trigger"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-required={ariaRequired}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? close() : openPanel())}
        className={cn(
          'flex w-full min-h-[var(--control-h)] items-center justify-between gap-2 rounded-input border bg-surface px-3 py-2.5 text-left text-sm',
          'transition duration-base ease-smooth focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
          'border-border focus:border-primary-400',
        )}
      >
        <span className={cn('truncate tabular-nums', display ? 'text-textMain' : 'text-neutral-400')}>
          {display || (placeholder ?? '')}
        </span>
        <CalendarIcon className="h-4 w-4 shrink-0 text-textMuted" />
      </button>

      <Popover open={open} anchorRef={anchorRef} onRequestClose={close} className="dg-datepicker w-76 p-3">
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={ariaLabelledby} onKeyDown={keepTab}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-expanded={view === 'my'}
              onClick={() => setView((v) => (v === 'my' ? 'days' : 'my'))}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold text-textMain hover:bg-bgHover"
            >
              {title}
              <Chevron dir="right" className={cn('h-3.5 w-3.5 text-primaryGraphic transition-transform duration-base', view === 'my' && 'rotate-90')} />
            </button>
            <div className="flex items-center gap-0.5">
              <button type="button" aria-label={view === 'my' ? previousYearsLabel : previousLabel} onClick={() => page(-1)} className="flex h-7 w-7 items-center justify-center rounded-btn text-textMuted hover:bg-bgHover"><Chevron dir="left" className="h-4 w-4" /></button>
              <button type="button" aria-label={view === 'my' ? nextYearsLabel : nextLabel} onClick={() => page(1)} className="flex h-7 w-7 items-center justify-center rounded-btn text-textMuted hover:bg-bgHover"><Chevron dir="right" className="h-4 w-4" /></button>
            </div>
          </div>

          {view === 'days' ? (
            // A screen reader leaves the arrow keys to a grid, where it keeps them on plain buttons.
            <div ref={gridRef} role="grid" aria-label={title} onKeyDown={moveDay} className="flex flex-col gap-0.5">
              <div role="row" className="mb-0.5 grid grid-cols-7">
                {weekdays.map((w, i) => (
                  <span key={i} role="columnheader" aria-label={w.long} className="text-center text-micro font-medium text-textMuted">{w.short}</span>
                ))}
              </div>
              {Array.from({ length: Math.ceil((off + days) / 7) }, (_, week) => (
                <div key={week} role="row" className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: 7 }, (_, col) => {
                    const d = week * 7 + col - off + 1;
                    // An empty cell keeps the days under their weekday for a screen reader as well.
                    if (d < 1 || d > days) return <span key={col} role="gridcell" />;
                    const isSel = !!selected && selected.y === my.y && selected.m === my.m && selected.d === d;
                    const isToday = now.getFullYear() === my.y && now.getMonth() === my.m && now.getDate() === d;
                    return (
                      <button key={col} type="button" role="gridcell" aria-selected={isSel}
                        aria-label={new Date(my.y, my.m, d).toLocaleDateString(locale, { dateStyle: 'full' })}
                        tabIndex={d === tabDay ? 0 : -1} onClick={() => pick({ y: my.y, m: my.m, d })}
                        className={cn(DAY_BTN, isSel && SEL, !isSel && isToday && TODAY)}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-4 gap-0.5">
                {Array.from({ length: 12 }, (_, mi) => (
                  <button key={mi} type="button" aria-pressed={mi === my.m}
                    onClick={() => { setMy((s) => ({ ...s, m: mi })); setView('days'); focusDayNext.current = true; }}
                    className={cn(DAY_BTN, 'min-h-9', mi === my.m && SEL)}>
                    {new Date(2000, mi, 1).toLocaleDateString(locale, { month: 'short' })}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-0.5 border-t border-border pt-2">
                {Array.from({ length: 12 }, (_, i) => {
                  const yr = yearBase + i;
                  return (
                    <button key={yr} type="button" aria-pressed={yr === my.y}
                      onClick={() => setMy((s) => ({ ...s, y: yr }))}
                      className={cn(DAY_BTN, 'min-h-9', yr === my.y && SEL, yr !== my.y && yr === now.getFullYear() && TODAY)}>
                      {yr}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {selected && (
            <div className="mt-2 flex justify-end border-t border-border pt-2">
              <button
                type="button"
                onClick={() => { onChange(undefined); close(); }}
                className="rounded-btn px-2 py-1 text-sm text-textMuted hover:bg-bgHover hover:text-textMain"
              >
                {clearLabel}
              </button>
            </div>
          )}
        </div>
      </Popover>
    </div>
  );
}
