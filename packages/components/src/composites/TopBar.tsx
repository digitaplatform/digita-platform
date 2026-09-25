import { type HTMLAttributes, forwardRef } from 'react';
import { cn } from '../lib/cn.js';

/** The classes of a borderless icon control in the top bar (menu, search, mode):
 *  the app's chrome and the website's header render theirs the same way. */
export const topBarButtonClass =
  'rounded-md p-1.5 text-textMuted transition-colors duration-base ease-smooth hover:bg-bgHover focus-visible:shadow-focus focus-visible:outline-none';

/** The classes of a borderless icon control in a rail's header row (close, collapse,
 *  expand): the app's brand chrome and the website's mobile drawer render theirs the
 *  same way. */
export const railButtonClass = 'rounded p-1 text-textMuted hover:bg-subtle';

/**
 * The top bar: one sticky row on the surface, divided from the page by a border.
 * `data-ui="topbar"` is the element a design restyles (the iOS design turns it
 * translucent), so every frontend renders its bar through this one component.
 */
export const TopBar = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(function TopBar(
  { className, ...props },
  ref,
) {
  return (
    <header
      ref={ref}
      data-ui="topbar"
      className={cn('sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4', className)}
      {...props}
    />
  );
});
