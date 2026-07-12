import { type InputHTMLAttributes, type ReactNode, forwardRef, useId } from 'react';
import { cn } from '../lib/cn.js';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Mandatory — the floating label IS the component. */
  label: string;
  error?: boolean;
  errorMessage?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  wrapperClassName?: string;
}

/**
 * Text field with a floating label INSIDE the frame (CSS-only float via
 * :placeholder-shown). Neutral default = outlined box with an inside label (reads
 * modern-neutral); Material = filled + 1px→2px underline, iOS = static caption
 * above. Distinct from Input (label ABOVE the frame) — use for hand-built,
 * platform-expressive forms; the metadata renderer keeps using Input.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, label, error, errorMessage, leftIcon, rightIcon, wrapperClassName, id, placeholder, disabled, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? props.name ?? autoId;
  const invalid = error || errorMessage != null;
  return (
    <div className={cn('flex flex-col gap-1', wrapperClassName)}>
      <div
        data-ui="textfield"
        data-invalid={invalid || undefined}
        className={cn(
          'relative flex items-center gap-2 rounded-input border bg-surface px-3 transition duration-base ease-smooth focus-within:border-primary-400 focus-within:shadow-focus',
          invalid ? 'border-error' : 'border-border',
          disabled && 'opacity-60',
        )}
      >
        {leftIcon && <span data-ui="textfield-icon" className="shrink-0 text-textMuted">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          data-ui="textfield-input"
          disabled={disabled}
          placeholder={placeholder ?? ' '}
          aria-invalid={invalid || undefined}
          className={cn(
            'peer min-w-0 flex-1 bg-transparent pb-2 pt-5 text-sm text-textMain outline-none disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        />
        <label
          data-ui="textfield-label"
          htmlFor={inputId}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-textMuted transition-all duration-base ease-smooth peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-primary-600 peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs"
        >
          {label}
        </label>
        {rightIcon && <span className="shrink-0 text-textMuted">{rightIcon}</span>}
      </div>
      {errorMessage && (
        <p role="alert" className="text-xs text-error">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
