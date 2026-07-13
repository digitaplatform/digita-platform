import type { Design, DesignMeta } from './types.js';
import minimal from './minimal/index.js';

export type { Design, DesignMeta } from './types.js';

// Runtime-loaded design plugins (registered by the host at composition time)
// live in their own registry — reactive, framework-agnostic.
export * from './runtime-registry.js';

/** The id painted at the bare `:root`/`.dark` blocks (no `data-design` attribute
 *  needed). Extracting a different default is a one-line change here. */
export const DEFAULT_DESIGN_ID = 'minimal';

// The ONLY list of BAKED designs — exactly the free default. The other design
// languages (editorial/fluent/ios/material) are PREMIUM design plugins now:
// delivered at runtime as entitlement-gated CSS artifacts and registered via the
// runtime registry above — never compiled into theme.css. Adding a baked design
// = one import above + one entry here; no core-logic edit anywhere else.
const ALL: Design[] = [minimal];

export const DESIGNS: Record<string, Design> = Object.fromEntries(ALL.map((d) => [d.meta.id, d]));

/** Data source for the generic design picker — never hardcode a design list in UI. */
export const DESIGN_LIST: DesignMeta[] = ALL.map((d) => d.meta);

/** Resolve an id to its design, falling back VISIBLY to the default for an
 *  unknown id (the caller still gets a real design; a missing CSS block would
 *  surface as an obvious fall-through, not a silent guess). */
export function getDesign(id: string | null | undefined): Design {
  return (id != null && DESIGNS[id]) || DESIGNS[DEFAULT_DESIGN_ID]!;
}
