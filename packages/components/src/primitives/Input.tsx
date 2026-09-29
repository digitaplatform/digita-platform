import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../lib/cn.js';

// `h-[var(--control-h)]` — the single-line control height the theme emits per design;
// the load-skeleton bar and packages/app's FIELD_CLASS read the same variable so a
// skeleton and its real control settle at the identical height (no 36→42px jump).
//
// C3 — locked/read-only fields drop the editable-box chrome for a filled "document" look
// (subtle fill, no outline, no shadow) so a submitted record reads as a document. Both
// lock paths are covered: `disabled` (some controls) AND `readOnly` (text inputs, which
// never match `:disabled`) — the latter via the `[readonly]` ATTRIBUTE, not the
// `read-only:` variant, because CSS `:read-only` also matches enabled non-text inputs.
// Dark keeps a hairline `borderStrong` edge because `subtle`
// barely separates from `surface` there (a transparent border would vanish).
const BARE =
  'w-full h-[var(--control-h)] rounded-input border border-border bg-surface px-3 py-2.5 text-sm text-textMain transition duration-base ease-smooth placeholder:text-neutral-400 focus:border-primary-400 focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:bg-subtle disabled:border-transparent disabled:shadow-none dark:disabled:border-borderStrong [&[readonly]]:bg-subtle [&[readonly]]:border-transparent [&[readonly]]:shadow-none dark:[&[readonly]]:border-borderStrong';

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
  /** Draw the framed box without a label, icons or error text, so a design's `input-frame`
   *  rules reach a control whose label the form renderer owns (a locked ReadOnly field). */
  framed?: boolean;
}

/**
 * Text input. By default a bare token-styled <input> (the form renderer owns the
 * label). Passing any of label/errorMessage/leftIcon/rightIcon switches it into a
 * self-contained form field (label + framed box with inline icons + error text) —
 * the single input for both the metadata form renderer and hand-built app forms.
 * `framed` asks for the box alone.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, errorMessage, leftIcon, rightIcon, wrapperClassName, framed, id, disabled, ...props },
  ref,
) {
  const fieldMode = framed || label != null || errorMessage != null || leftIcon != null || rightIcon != null;
  const invalid = error || errorMessage != null;

  if (!fieldMode) {
    return (
      <input
        ref={ref}
        data-ui="input"
        id={id}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(BARE, className)}
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
        // The frame is a <div> with no :disabled, :read-only or :invalid pseudo-state,
        // so the state the inner input holds is mirrored as attributes: the theme's
        // base rule paints the invalid border, a design keys its locked look on them.
        aria-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={props.readOnly || undefined}
        className={cn(
          'flex min-h-[var(--control-h)] items-center gap-2 rounded-input border border-border bg-surface px-3 transition duration-base ease-smooth focus-within:shadow-focus',
          // C3 — locked frame gets the same "document" resting look as the bare input;
          // cn's tailwind-merge lets these override the bg-surface/border above.
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
        <p id={`${inputId}-error`} data-ui="field-error" role="alert" className="text-xs text-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
