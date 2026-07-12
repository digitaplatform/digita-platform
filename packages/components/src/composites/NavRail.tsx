import { type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

/**
 * NORDSTERN F13 — navigation-rail primitives (REFERENCE — adapt imports).
 *
 * The nav rail was hand-rolled inside the usermenu plugin; these composites
 * move the visual vocabulary into the kit so EVERY plugin/nav surface shares
 * it, and expose stable [data-ui] hooks ("nav-list" / "nav-sub" / "nav-group"
 * / "nav-leaf") so the variant layers (iOS/Material) can restyle navigation
 * exactly like every other component. Values are the ones UserMenuNav.tsx
 * ships today — extraction, not redesign.
 */

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function NavList({ children, sub }: { children: ReactNode; sub?: boolean }) {
  return (
    <ul data-ui={sub ? 'nav-sub' : 'nav-list'} className={cn('space-y-0.5', sub && 'ml-4 border-l border-border pl-2')}>
      {children}
    </ul>
  );
}

export interface NavGroupProps {
  label: ReactNode;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** The sub list (render a <NavList sub> yourself). */
  children?: ReactNode;
}

export function NavGroup({ label, icon, open, onToggle, children }: NavGroupProps) {
  return (
    <li>
      <button
        type="button"
        data-ui="nav-group"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-textMain transition duration-base ease-smooth hover:bg-bgHover focus-visible:shadow-focus focus-visible:outline-none"
      >
        {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>}
        <span className="flex-1 truncate">{label}</span>
        <ChevronIcon className={cn('h-4 w-4 shrink-0 text-textMuted transition-transform duration-base ease-smooth', open && 'rotate-90')} />
      </button>
      {open && children}
    </li>
  );
}

/** Class for the leaf's interactive element (NavLink/a/button — the caller owns
 *  the element so router links keep working): resting row vs active pill. */
export function navLeafClass(active: boolean): string {
  return cn(
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition duration-base ease-smooth focus-visible:shadow-focus focus-visible:outline-none',
    active ? 'bg-bgHover font-medium text-primary-600' : 'text-textMain hover:bg-bgHover',
  );
}

/** Leaf content: icon slot + truncating label + optional trailing node. */
export function NavLeafContent({ icon, trailing, children }: { icon?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </>
  );
}
