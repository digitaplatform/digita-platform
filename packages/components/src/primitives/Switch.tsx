import { type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional inline label to the right (clicking it toggles). */
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * A boolean toggle — a `role="switch"` button with a track + thumb. Neutral by
 * default (36×20 pill); the highest-signal control the iOS (51×31, green on-state)
 * and Material 3 (52×32, growing thumb) variant layers restyle purely via CSS.
 * Use for form booleans; keep Checkbox for multi-select / selection UIs.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}: SwitchProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      id={id}
      name={name}
      data-ui="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent',
        'transition-colors duration-base ease-smooth',
        checked ? 'bg-primary-600' : 'bg-neutral-300',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <span
        data-ui="switch-thumb"
        aria-hidden="true"
        className={cn(
          // onPrimary (not bg-white): the token designed for "sits ON a primary
          // fill" — white in the default design, overridable per design.
          'pointer-events-none flex h-4 w-4 items-center justify-center rounded-full bg-onPrimary shadow-sm',
          'transition-transform duration-base ease-smooth',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      >
        <svg data-ui="switch-check" viewBox="0 0 20 20" fill="none" className="hidden h-3 w-3">
          <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );

  if (label == null) return control;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-textMain">
      {control}
      <span
        onClick={() => !disabled && onChange(!checked)}
        className={cn('select-none', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}
      >
        {label}
      </span>
    </span>
  );
}
