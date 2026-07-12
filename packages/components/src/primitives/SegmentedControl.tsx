import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn.js';

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}
export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Mandatory — a segmented control is otherwise an unnamed radiogroup. */
  'aria-label': string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Where the selected segment sits — the thumb's slide target (px, box-relative). */
interface ThumbRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Single-choice control rendered as a pill group (`role="radiogroup"` + roving
 * tabindex; Arrow keys move + select). The selected state is painted by a purely
 * visual SLIDING THUMB (`data-ui="segmented-thumb"`) that animates under the
 * selected segment on --duration-base/ease-smooth — the API and semantics are
 * unchanged. The neutral default already reads as the familiar iOS-style
 * segmented pill; the iOS variant sharpens it and the Material variant turns it
 * into M3 outlined segmented buttons — all via CSS on the data-ui nodes.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  size = 'md',
  className,
}: SegmentedControlProps) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const [thumb, setThumb] = useState<ThumbRect | null>(null);

  // Measure the selected segment from the DOM (not from props) so the thumb is
  // correct for ANY variant geometry (padding/dividers differ per design).
  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-ui="segmented-item"][data-selected]');
    if (!el) {
      setThumb(null);
      return;
    }
    const next: ThumbRect = {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
    setThumb((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    );
  }, []);

  // After every render (selection, labels or size may have changed) — one cheap
  // DOM read; the setState above bails out when nothing moved.
  useLayoutEffect(measure);

  // Re-measure when the control itself resizes (font load, container reflow).
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const host = ref.current;
    if (!host) return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [measure]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = enabled.findIndex((o) => o.value === value);
    if (idx < 0 || enabled.length === 0) return;
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + enabled.length) % enabled.length;
    else return;
    e.preventDefault();
    const nv = enabled[next]!;
    onChange(nv.value);
    ref.current?.querySelector<HTMLButtonElement>(`[data-value="${nv.value}"]`)?.focus();
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      data-ui="segmented"
      className={cn('relative inline-flex items-center gap-0.5 rounded-btn bg-subtle p-0.5', className)}
    >
      {thumb && (
        <span
          data-ui="segmented-thumb"
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 rounded-[calc(var(--radius-btn)-2px)] bg-surface shadow-xs transition-[transform,width,height] duration-base ease-smooth"
          style={{
            width: thumb.width,
            height: thumb.height,
            transform: `translate(${thumb.left}px, ${thumb.top}px)`,
          }}
        />
      )}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            data-ui="segmented-item"
            data-value={o.value}
            data-selected={selected || undefined}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={cn(
              // `relative` lifts the label above the absolutely-positioned thumb.
              'relative inline-flex items-center gap-1.5 rounded-[calc(var(--radius-btn)-2px)] py-1.5 text-sm',
              size === 'sm' ? 'px-2.5' : 'px-3',
              'transition duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus',
              selected ? 'font-medium text-textMain' : 'text-textMuted hover:text-textMain',
              o.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span data-ui="segmented-check" aria-hidden="true" className="hidden">
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
