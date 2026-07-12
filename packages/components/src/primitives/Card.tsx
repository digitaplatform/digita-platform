import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.js';

type Elevation = 'flat' | 'raised' | 'floating';
type CardVariant = 'default' | 'interactive' | 'elevated' | 'flat';

/** Weightless by default: borderless + flat. Hierarchy comes from whitespace, not
 *  a frame. The few cards that need to lift off the page opt into a soft shadow via
 *  `elevation` (raised = resting, floating = menus/dialogs). */
const ELEVATION: Record<Elevation, string> = {
  flat: '',
  raised: 'shadow-sm',
  floating: 'shadow-md',
};

/** Framed cards (opt-in via `variant`): bordered, rounded, NO inner padding — the
 *  Card.Header/Content/Footer subparts own the spacing. */
const VARIANT: Record<CardVariant, string> = {
  default: 'border border-border bg-surface',
  interactive: 'border border-border bg-surface hover:border-primary-300 hover:shadow-md cursor-pointer',
  elevated: 'border border-border bg-surface shadow-lg',
  flat: 'border border-transparent bg-subtle',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
  /** Opt into a framed card (border + subparts own padding). Omit for the
   *  default weightless, padded card. */
  variant?: CardVariant;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, elevation = 'flat', variant, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-ui="card"
      data-variant={variant ?? 'plain'}
      className={
        variant
          ? cn('rounded-card', VARIANT[variant], className)
          : cn('rounded-card bg-surface p-[var(--density-pad)]', ELEVATION[elevation], className)
      }
      {...props}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-between gap-3 border-b border-border px-5 py-4', className)}
        {...props}
      />
    );
  },
);

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('px-5 py-4', className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-end gap-3 border-t border-border px-5 py-4', className)}
        {...props}
      />
    );
  },
);
