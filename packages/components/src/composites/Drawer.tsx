import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '../lib/cn.js';
import { useFocusTrap } from '../lib/use-focus-trap.js';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the drawer dialog. */
  label: string;
  /** The edge the panel is docked to. */
  side?: 'left' | 'right';
  /** Classes of the overlay (e.g. `lg:hidden` to show it below a breakpoint only). */
  className?: string;
  children: ReactNode;
}

/**
 * A modal side drawer over the page: a dimmed, blurred scrim that closes it, and a
 * panel docked to one edge that is a labelled dialog — Escape closes it, focus moves
 * in on open, stays trapped inside, and returns to the opener on close. The app's
 * mobile navigation and the website's open through it.
 */
export function Drawer({ open, onClose, label, side = 'left', className, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={cn('fixed inset-0 z-40', className)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn('absolute inset-y-0 shadow-md focus:outline-none focus-visible:shadow-focus', side === 'right' ? 'right-0' : 'left-0')}
      >
        {children}
      </div>
    </div>
  );
}
