/**
 * Categorical identity palette — the 8 design-agnostic hues the theme emits as
 * `--color-cat-1..8` (+ `-soft` tint), surfaced by the Tailwind preset as
 * `bg-cat-N` / `bg-cat-N-soft` / `text-cat-N` / `border-cat-N`. Used to give
 * peer items (e.g. report data sources / collections) a stable visual identity.
 *
 * The class maps below spell every utility out as a full literal so Tailwind's
 * content scanner picks them up.
 */
export type CategoricalColor =
  | 'cat-1'
  | 'cat-2'
  | 'cat-3'
  | 'cat-4'
  | 'cat-5'
  | 'cat-6'
  | 'cat-7'
  | 'cat-8';

/** Soft treatment — tinted fill + solid categorical text (Badge's soft-status look). */
export const CATEGORICAL_SOFT: Record<CategoricalColor, string> = {
  'cat-1': 'bg-cat-1-soft text-cat-1',
  'cat-2': 'bg-cat-2-soft text-cat-2',
  'cat-3': 'bg-cat-3-soft text-cat-3',
  'cat-4': 'bg-cat-4-soft text-cat-4',
  'cat-5': 'bg-cat-5-soft text-cat-5',
  'cat-6': 'bg-cat-6-soft text-cat-6',
  'cat-7': 'bg-cat-7-soft text-cat-7',
  'cat-8': 'bg-cat-8-soft text-cat-8',
};

/** Outline treatment — solid categorical border + text (Badge's outline-status look). */
export const CATEGORICAL_OUTLINE: Record<CategoricalColor, string> = {
  'cat-1': 'border border-cat-1 text-cat-1',
  'cat-2': 'border border-cat-2 text-cat-2',
  'cat-3': 'border border-cat-3 text-cat-3',
  'cat-4': 'border border-cat-4 text-cat-4',
  'cat-5': 'border border-cat-5 text-cat-5',
  'cat-6': 'border border-cat-6 text-cat-6',
  'cat-7': 'border border-cat-7 text-cat-7',
  'cat-8': 'border border-cat-8 text-cat-8',
};
