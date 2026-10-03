import { createElement, type ReactNode } from 'react';
import { icons } from 'lucide-react';

const ICON_BY_NAME = new Map(Object.entries(icons).map(([name, icon]) => [name.toLowerCase(), icon]));

/**
 * Resolve a metadata-declared lucide icon name to a rendered icon node. App data
 * supplies arbitrary names; an unknown name is COSMETIC (not load-bearing) so it
 * degrades to no icon + a dev warning rather than failing what draws it. Returns
 * undefined when no name is given or the name does not resolve.
 */
export function lucideIcon(name: string | undefined, size = 16): ReactNode {
  if (!name) return undefined;
  const Comp = ICON_BY_NAME.get(name.replace(/[-_\s]+/g, '').toLowerCase());
  if (!Comp) {
    if (import.meta.env.DEV) console.warn(`[icon] unknown lucide icon "${name}"`);
    return undefined;
  }
  return createElement(Comp, { size, 'aria-hidden': true });
}
