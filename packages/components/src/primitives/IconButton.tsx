import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './Spinner.js';
import { Tooltip } from './Tooltip.js';

/**
 * Icon-only button. `label` is mandatory — it is the accessible name AND the
 * tooltip text, so an icon-only control is never unlabelled. Icon-agnostic: the
 * caller passes the `icon` node (lucide lives in the apps, not this package).
 */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary-600 text-onPrimary hover:bg-primary-700',
  secondary: 'bg-subtle text-textMain hover:bg-bgHover',
  ghost: 'text-textMuted hover:bg-bgHover hover:text-textMain',
  danger: 'text-error hover:bg-error-light',
};
const SIZES: Record<Size, string> = { sm: 'h-7 w-7', md: 'h-9 w-9' };

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  icon: ReactNode;
  variant?: Variant;
  size?: Size;
  tooltipSide?: 'top' | 'bottom';
  loading?: boolean;
  /** Class for the Tooltip wrapper (the real flex item) — e.g. shrink-0. */
  wrapperClassName?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', tooltipSide, loading = false, wrapperClassName, className, type = 'button', disabled, ...props },
  ref,
) {
  return (
    <Tooltip label={label} side={tooltipSide} className={wrapperClassName}>
      <button
        ref={ref}
        {...props}
        data-ui="icon-button"
        data-variant={variant}
        type={type}
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center rounded-btn transition duration-base ease-smooth',
          SIZES[size],
          'focus-visible:outline-none focus-visible:shadow-focus',
          'disabled:cursor-not-allowed disabled:opacity-50',
          VARIANTS[variant],
          className,
        )}
      >
        {loading ? <Spinner className="h-4 w-4" /> : icon}
      </button>
    </Tooltip>
  );
});
