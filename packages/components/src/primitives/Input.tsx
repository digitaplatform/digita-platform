import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../lib/cn.js';

// `h-[var(--control-h,2.625rem)]` — the shared single-line control height (BUG-2
// reflow fix). The literal 2.625rem (42px) is the historical padded height; the
// `--control-h` design token can override it, and the load-skeleton bar + digita-ui's
// FIELD_CLASS reference the same expression so a skeleton and its real control settle
// at the identical height (no 36→42px jump).
//
// C3 — locked/read-only fields drop the editable-box chrome for a filled "document" look
// (subtle fill, no outline, no shadow) so a submitted record reads as a document. Both
// lock paths are covered: `disabled` (some controls) AND `readOnly` (text inputs, which
// never match `:disabled`) — the latter via the `[readonly]` ATTRIBUTE, not the
// `read-only:` variant, because CSS `:read-only` also matches enabled non-text inputs.
// Dark keeps a hairline `borderStrong` edge because `subtle`
// barely separates from `surface` there (a transparent border would vanish).
const BARE =
  'w-full h-[var(--control-h,2.625rem)] rounded-input border border-border bg-surface px-3 py-2.5 text-sm text-textMain transition duration-base ease-smooth placeholder:text-neutral-400 focus:border-primary-400 focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:bg-subtle disabled:border-transparent disabled:shadow-none dark:disabled:border-borderStrong [&[readonly]]:bg-subtle [&[readonly]]:border-transparent [&[readonly]]:shadow-none dark:[&[readonly]]:border-borderStrong';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional field label above the input. */
  label?: ReactNode;
  /** Error styling (red border / aria-invalid). */
  error?: boolean;
  /** Error text below the input (implies error styling). */
  errorMessage?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  wrapperClassName?: string;
}

/**
 * Text input. By default a bare token-styled <input> (the form renderer owns the
 * label). Passing any of label/errorMessage/leftIcon/rightIcon switches it into a
 * self-contained form field (label + framed box with inline icons + error text) —
 * the single input for both the metadata form renderer and hand-built app forms.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, errorMessage, leftIcon, rightIcon, wrapperClassName, id, disabled, ...props },
  ref,
) {
  const fieldMode = label != null || errorMessage != null || leftIcon != null || rightIcon != null;
  const invalid = error || errorMessage != null;

  if (!fieldMode) {
    return (
      <input
        ref={ref}
        data-ui="input"
        id={id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(BARE, invalid && 'border-error focus:border-error', className)}
        {...props}
      />
    );
  }

  const inputId = id ?? props.name;
  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      {label != null && (
        <label htmlFor={inputId} data-ui="field-label" className="text-xs font-medium text-textMuted">
          {label}
        </label>
      )}
      <div
        data-ui="input-frame"
        className={cn(
          'flex items-center gap-2 rounded-input border bg-surface px-3 transition duration-base ease-smooth focus-within:shadow-focus',
          invalid ? 'border-error' : 'border-border',
          // C3 — locked frame gets the same "document" resting look as the bare input.
          // The frame is a <div> (no :disabled/:read-only pseudo-state), so switch via JS;
          // cn's tailwind-merge lets these override the bg-surface/border above. `readOnly`
          // rides in `props` (only `disabled` is destructured), so read it from there.
          (disabled || props.readOnly) &&
            'bg-subtle border-transparent shadow-none dark:border-borderStrong',
        )}
      >
        {leftIcon && <span className="shrink-0 text-textMuted">{leftIcon}</span>}
        <input
          ref={ref}
          data-ui="input"
          id={inputId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={errorMessage ? `${inputId}-error` : undefined}
          className={cn(
            'min-w-0 flex-1 bg-transparent py-2.5 text-sm text-textMain outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        />
        {rightIcon && <span className="shrink-0 text-textMuted">{rightIcon}</span>}
      </div>
      {errorMessage && (
        <p id={`${inputId}-error`} role="alert" className="text-xs text-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
