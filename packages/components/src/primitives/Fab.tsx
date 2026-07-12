import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

export interface FabProps {
  /** Accessible name; also the extended-FAB text. */
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Show the label next to the icon (M3 extended FAB). */
  extended?: boolean;
  /** Adaptive FABs are HIDDEN by default and shown only where the active design's
   *  variant layer opts them in (Material) — so the same JSX is safe in every
   *  design. Non-adaptive = always visible. */
  adaptive?: boolean;
  className?: string;
}

/**
 * Floating action button — portaled to <body> so it escapes overflow/transform
 * containers (the one unavoidable bit of JS). Neutral circular primary button;
 * the Material variant gives it the M3 primary-container surface + elevation.
 */
export function Fab({ label, icon, onClick, extended, adaptive, className }: FabProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <button
      type="button"
      data-ui="fab"
      data-adaptive={adaptive ? '' : undefined}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'fixed bottom-6 right-6 z-popover inline-flex h-14 items-center justify-center gap-2',
        extended ? 'px-5' : 'w-14',
        'relative isolate overflow-hidden rounded-full bg-primary-600 text-onPrimary shadow-lg',
        'transition duration-base ease-smooth hover:shadow-lg active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:shadow-focus',
        className,
      )}
    >
      {icon}
      {extended && <span className="text-sm font-medium">{label}</span>}
    </button>,
    document.body,
  );
}
