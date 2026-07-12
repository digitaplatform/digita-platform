import type { Design, DesignMeta } from './types.js';
import editorial from './editorial/index.js';
import fluent from './fluent/index.js';
import minimal from './minimal/index.js';
import ios from './ios/index.js';
import material from './material/index.js';

export type { Design, DesignMeta } from './types.js';

/** The id painted at the bare `:root`/`.dark` blocks (no `data-design` attribute
 *  needed). Extracting a different default is a one-line change here. */
export const DEFAULT_DESIGN_ID = 'editorial';

// The ONLY list of designs. Adding a design = one import above + one entry here;
// no core-logic edit anywhere else. (tsc-only build → no import.meta.glob; an
// explicit barrel is the honest, type-safe equivalent.)
const ALL: Design[] = [editorial, fluent, minimal, ios, material];

export const DESIGNS: Record<string, Design> = Object.fromEntries(ALL.map((d) => [d.meta.id, d]));

/** Data source for the generic design picker — never hardcode a design list in UI. */
export const DESIGN_LIST: DesignMeta[] = ALL.map((d) => d.meta);

/** Resolve an id to its design, falling back VISIBLY to the default for an
 *  unknown id (the caller still gets a real design; a missing CSS block would
 *  surface as an obvious fall-through, not a silent guess). */
export function getDesign(id: string | null | undefined): Design {
  return (id != null && DESIGNS[id]) || DESIGNS[DEFAULT_DESIGN_ID]!;
}
