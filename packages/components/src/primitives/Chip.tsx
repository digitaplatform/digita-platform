import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import {
  CATEGORICAL_OUTLINE,
  CATEGORICAL_SOFT,
  type CategoricalColor,
} from '../lib/categorical.js';

interface ChipBaseProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'className' | 'color' | 'onClick'> {
  children: ReactNode;
  /** Filter-chip selection state; omit for an assist/action chip. */
  selected?: boolean;
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

/** An action chip: the whole chip is one button. */
interface ActionChipProps extends ChipBaseProps {
  onClick?: () => void;
  onRemove?: never;
  removeLabel?: never;
}

/** An input chip: a passive label whose only control is its × button, so a screen
 *  reader hears the label and then the named remove action, never a toggle. */
interface RemovableChipProps extends ChipBaseProps {
  onRemove: () => void;
  /** Accessible name of the × button, already localized. */
  removeLabel: string;
  onClick?: never;
}

export type ChipProps = ActionChipProps | RemovableChipProps;

/**
 * Interactive chip (filter / assist / input) — the active sibling of the passive
 * Badge. Neutral default rounded pill; iOS = gray fill → filled-primary when
 * selected, Material = 8px outlined → tonal + leading check when selected.
 */
export function Chip({ children, selected, onClick, onRemove, removeLabel, icon, disabled, color, className, ...props }: ChipProps) {
  const look = cn(
    'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs font-medium',
    'transition-colors duration-base ease-smooth focus-visible:outline-none focus-visible:shadow-focus',
    color
      ? cn(CATEGORICAL_SOFT[color], selected ? CATEGORICAL_OUTLINE[color] : 'border-transparent')
      : selected
        ? 'border-transparent bg-primaryContainer text-onPrimaryContainer'
        : 'border-border bg-surface text-textMain hover:bg-bgHover',
    disabled && 'cursor-not-allowed opacity-50',
    className,
  );
  const content = (
    <>
      <span data-ui="chip-check" aria-hidden="true" className="hidden">
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
          <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {icon}
      {children}
    </>
  );
  if (onRemove) {
    return (
      <span {...props} data-ui="chip" data-selected={selected || undefined} data-color={color} className={look}>
        {content}
        <button
          type="button"
          data-ui="chip-remove"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
          className="-mr-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-current opacity-70 hover:bg-bgHover hover:opacity-100 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed"
        >
          ×
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      {...props}
      data-ui="chip"
      data-selected={selected || undefined}
      data-color={color}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={look}
    >
      {content}
    </button>
  );
}
