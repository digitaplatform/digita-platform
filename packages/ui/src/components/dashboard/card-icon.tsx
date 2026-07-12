import { createElement, type ReactNode } from 'react';
import { icons } from 'lucide-react';

/** Convert a lucide icon name (kebab "layout-dashboard" or pascal "LayoutDashboard")
 *  to the PascalCase key used by lucide-react's `icons` record. */
function toPascal(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/**
 * Resolve a metadata-declared lucide icon name to a rendered icon node. App data
 * supplies arbitrary names; an unknown name is COSMETIC (not load-bearing) so it
 * degrades to no icon + a dev warning rather than failing the card. Returns
 * undefined when no name is given or the name does not resolve.
 */
export function cardIcon(name: string | undefined, size = 16): ReactNode {
  if (!name) return undefined;
  const Comp = icons[toPascal(name) as keyof typeof icons];
  if (!Comp) {
    if (import.meta.env.DEV) console.warn(`[dashboard] unknown lucide icon "${name}"`);
    return undefined;
  }
  return createElement(Comp, { size, 'aria-hidden': true });
}
