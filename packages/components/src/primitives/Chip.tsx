import { type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import {
  CATEGORICAL_OUTLINE,
  CATEGORICAL_SOFT,
  type CategoricalColor,
} from '../lib/categorical.js';

export interface ChipProps {
  children: ReactNode;
  /** Filter-chip selection state; omit for an assist/action chip. */
  selected?: boolean;
  onClick?: () => void;
  /** Renders a trailing remove (×) affordance (input chip). */
  onRemove?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  /**
   * Categorical identity color (`cat-1..8`) — soft tinted fill + solid
   * categorical text (Badge's soft look); selection adds the solid categorical
   * border. Omit for today's neutral look (unchanged default).
   */
  color?: CategoricalColor;
  className?: string;
}

/**
 * Interactive chip (filter / assist / input) — the active sibling of the passive
 * Badge. Neutral default rounded pill; iOS = gray fill → filled-primary when
 * selected, Material = 8px outlined → tonal + leading check when selected.
 */
export function Chip({ children, selected, onClick, onRemove, icon, disabled, color, className }: ChipProps) {
  return (
    <button
      type="button"
      data-ui="chip"
      data-selected={selected || undefined}
      data-color={color}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium',
        'transition-colors duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus',
        color
          ? cn(CATEGORICAL_SOFT[color], selected ? CATEGORICAL_OUTLINE[color] : 'border-transparent')
          : selected
            ? 'border-transparent bg-primary-100 text-primary-700'
            : 'border-border bg-surface text-textMain hover:bg-bgHover',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span data-ui="chip-check" aria-hidden="true" className="hidden">
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
          <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {icon}
      {children}
      {onRemove && (
        <span
          data-ui="chip-remove"
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-current opacity-70 hover:bg-bgHover hover:opacity-100"
        >
          ×
        </span>
      )}
    </button>
  );
}
