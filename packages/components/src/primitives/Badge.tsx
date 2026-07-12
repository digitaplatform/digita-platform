import { type HTMLAttributes, type ReactNode, forwardRef } from 'react';
import { cn } from '../lib/cn.js';
import {
  CATEGORICAL_OUTLINE,
  CATEGORICAL_SOFT,
  type CategoricalColor,
} from '../lib/categorical.js';

type BadgeVariant = 'soft' | 'outline' | 'pill';
type BadgeColor = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | CategoricalColor;
type BadgeSize = 'sm' | 'md' | 'lg';

const SOFT: Record<BadgeColor, string> = {
  neutral: 'bg-subtle text-textMuted',
  primary: 'bg-primary-100 text-primary-700',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  error: 'bg-error-light text-error',
  info: 'bg-info-light text-info',
  ...CATEGORICAL_SOFT,
};

const OUTLINE: Record<BadgeColor, string> = {
  neutral: 'border border-borderStrong text-textMain',
  primary: 'border border-primary-300 text-primary-700',
  success: 'border border-success text-success',
  warning: 'border border-warning text-warning',
  error: 'border border-error text-error',
  info: 'border border-info text-info',
  ...CATEGORICAL_OUTLINE,
};

const SIZE: Record<BadgeSize, string> = {
  sm: 'gap-1 px-1.5 py-0.5 text-micro',
  md: 'gap-1 px-2 py-0.5 text-xs',
  lg: 'gap-1.5 px-2.5 py-1 text-xs',
};

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** `soft` = tinted fill (default), `outline` = bordered, `pill` = tinted + fully rounded. */
  variant?: BadgeVariant;
  color?: BadgeColor;
  size?: BadgeSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/** Status/label chip for every frontend — variant × color × size, optional icons. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'soft', color = 'neutral', size = 'md', leftIcon, rightIcon, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-ui="badge"
      data-variant={variant}
      className={cn(
        'inline-flex items-center font-medium',
        SIZE[size],
        variant === 'pill' ? 'rounded-full' : 'rounded-md',
        variant === 'outline' ? cn('bg-transparent', OUTLINE[color]) : SOFT[color],
        className,
      )}
      {...props}
    >
      {leftIcon && <span className="shrink-0">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </span>
  );
});
