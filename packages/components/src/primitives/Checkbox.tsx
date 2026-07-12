import { type InputHTMLAttributes, type ReactNode, forwardRef, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.js';

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional inline label rendered to the right of the box. */
  label?: ReactNode;
  /** Tri-state (e.g. a header "select all"). */
  indeterminate?: boolean;
}

/**
 * Styled checkbox: a real <input type="checkbox"> (a11y + form semantics) with the
 * native box hidden (appearance-none) and a token-styled box + check overlay.
 * Optional inline `label` and `indeterminate` tri-state. Brands + dark-modes via
 * the theme tokens; pass checked/onChange like a native checkbox.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, indeterminate = false, id, ...props },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const box = (
    <span data-ui="checkbox-box" className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        data-ui="checkbox"
        id={id}
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="checkbox"
        className={cn(
          'peer h-4 w-4 cursor-pointer appearance-none rounded-input border border-border bg-surface',
          'transition duration-base ease-smooth',
          'checked:border-primary-600 checked:bg-primary-600 indeterminate:border-primary-600 indeterminate:bg-primary-600',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
      <svg
        className="pointer-events-none absolute h-3 w-3 text-onPrimary opacity-0 peer-checked:opacity-100"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );

  if (label === undefined) return box;
  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-textMain"
    >
      {box}
      <span>{label}</span>
    </label>
  );
});
