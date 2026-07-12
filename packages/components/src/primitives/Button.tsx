import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './Spinner.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Leading icon node (hidden while loading). */
  leftIcon?: ReactNode;
  /** Trailing icon node (hidden while loading). */
  rightIcon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary-600 text-onPrimary hover:bg-primary-700 hover:shadow-xs disabled:bg-primary-300',
  secondary: 'bg-subtle text-textMain hover:bg-bgHover',
  ghost: 'text-textMain hover:bg-bgHover',
  danger: 'bg-error text-onError hover:opacity-90',
  outline: 'border border-border text-textMain hover:bg-bgHover',
};

const SIZES: Record<Size, string> = {
  xs: 'gap-1 px-2.5 py-1 text-xs',
  sm: 'gap-1.5 px-3.5 py-2 text-xs',
  md: 'gap-2 px-4 py-2.5 text-sm',
  lg: 'gap-2 px-6 py-3 text-base',
};

/**
 * The one button for every React frontend. Token-styled, with variants, sizes, a
 * loading state, and optional leading/trailing icons (icon nodes are passed in —
 * no icon-library dependency in the kit). For icon-only buttons use IconButton.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      data-ui="button"
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-btn font-medium',
        'transition duration-base ease-smooth active:scale-[0.97] active:opacity-90',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'disabled:cursor-not-allowed disabled:active:scale-100',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Spinner className="h-4 w-4" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children}
      {rightIcon && !loading && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
});
