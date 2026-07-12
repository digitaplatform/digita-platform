import {
  useCallback,
  useMemo,
  useRef,
  useState,
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
 * Value contract: 'YYYY-MM-DD' string or undefined (matches DateControl).
 * Week starts Monday (format-locale follow-up: derive from Intl.Locale).
 */

export interface DatePickerProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  /** BCP-47 format locale from the boot session (e.g. 'de-CH'). */
  locale?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
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
const TODAY = 'font-semibold text-primary-600';

export function DatePicker({
  value,
  onChange,
  locale,
  placeholder,
  disabled,
  invalid,
  id,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-required': ariaRequired,
}: DatePickerProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'days' | 'my'>('days');
  const selected = useMemo(() => parseIso(value), [value]);
  const [my, setMy] = useState<{ y: number; m: number }>(() => {
    const s = selected ?? { y: new Date().getFullYear(), m: new Date().getMonth(), d: 1 };
    return { y: s.y, m: s.m };
  });
  const [yearBase, setYearBase] = useState(my.y - 7);

  const openPanel = useCallback(() => {
    const s = parseIso(value) ?? { y: new Date().getFullYear(), m: new Date().getMonth(), d: 1 };
    setMy({ y: s.y, m: s.m });
    setYearBase(s.y - 7);
    setView('days');
    setOpen(true);
  }, [value]);

  const pick = (ymd: Ymd) => { onChange(toIso(ymd)); setOpen(false); };

  const display = selected
    ? new Date(selected.y, selected.m, selected.d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  const title = new Date(my.y, my.m, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekdays = useMemo(() => {
    // Monday-start localized two-letter weekday row.
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, i + 1).toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2),
    );
  }, [locale]);

  const off = (new Date(my.y, my.m, 1).getDay() + 6) % 7;
  const days = new Date(my.y, my.m + 1, 0).getDate();
  const now = new Date();

  const page = (dir: 1 | -1) => {
    if (view === 'my') { setYearBase((b) => b + dir * 12); return; }
    setMy(({ y, m }) => (m + dir < 0 ? { y: y - 1, m: 11 } : m + dir > 11 ? { y: y + 1, m: 0 } : { y, m: m + dir }));
  };

  return (
    <div ref={anchorRef} className="relative">
      <button
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
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-input border bg-surface px-3 py-2.5 text-left text-sm',
          'transition duration-base ease-smooth focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
          invalid ? 'border-error focus:border-error' : 'border-border focus:border-primary-400',
        )}
      >
        <span className={cn('truncate tabular-nums', display ? 'text-textMain' : 'text-neutral-400')}>
          {display || (placeholder ?? '')}
        </span>
        <CalendarIcon className="h-4 w-4 shrink-0 text-textMuted" />
      </button>

      <Popover open={open} anchorRef={anchorRef} onRequestClose={() => setOpen(false)} className="dg-datepicker w-76 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-expanded={view === 'my'}
            onClick={() => setView((v) => (v === 'my' ? 'days' : 'my'))}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-semibold text-textMain hover:bg-bgHover"
          >
            {title}
            <Chevron dir="right" className={cn('h-3.5 w-3.5 text-primary-600 transition-transform duration-base', view === 'my' && 'rotate-90')} />
          </button>
          <div className="flex items-center gap-0.5">
            <button type="button" aria-label="Previous" onClick={() => page(-1)} className="flex h-7 w-7 items-center justify-center rounded-btn text-textMuted hover:bg-bgHover"><Chevron dir="left" className="h-4 w-4" /></button>
            <button type="button" aria-label="Next" onClick={() => page(1)} className="flex h-7 w-7 items-center justify-center rounded-btn text-textMuted hover:bg-bgHover"><Chevron dir="right" className="h-4 w-4" /></button>
          </div>
        </div>

        {view === 'days' ? (
          <>
            <div className="mb-1 grid grid-cols-7">
              {weekdays.map((w, i) => (
                <span key={i} className="text-center text-micro font-medium text-textMuted">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: Math.ceil((off + days) / 7) * 7 }, (_, i) => {
                const d = i - off + 1;
                if (d < 1 || d > days) return <span key={i} aria-hidden="true" />;
                const isSel = !!selected && selected.y === my.y && selected.m === my.m && selected.d === d;
                const isToday = now.getFullYear() === my.y && now.getMonth() === my.m && now.getDate() === d;
                return (
                  <button key={i} type="button" aria-pressed={isSel} onClick={() => pick({ y: my.y, m: my.m, d })}
                    className={cn(DAY_BTN, isSel && SEL, !isSel && isToday && TODAY)}>
                    {d}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-4 gap-0.5">
              {Array.from({ length: 12 }, (_, mi) => (
                <button key={mi} type="button" aria-pressed={mi === my.m}
                  onClick={() => { setMy((s) => ({ ...s, m: mi })); setView('days'); }}
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
      </Popover>
    </div>
  );
}
