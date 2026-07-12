/** Shared single-line control height (BUG-2 reflow fix). One source of truth for a
 *  single-line control's height AND the load-skeleton bar that stands in for it, so
 *  they settle at the exact same height (no 36→42px jump). Overridable per design via
 *  a `--control-h` token; the literal is the default (2.625rem = 42px, the historical
 *  padded height). The @digitaplatform/components Input BARE + the FormSkeleton bar use the
 *  same expression, so all three stay locked together. */
export const CONTROL_H = 'var(--control-h,2.625rem)';

/** Base input chrome (height-free) so native controls (select/textarea/display div)
 *  match the @digitaplatform/components Input primitive. Token classes only. Each consumer
 *  sets its own vertical bound on top — FIELD_CLASS a single-line floor, TEXTAREA_CLASS
 *  the multi-line bounds — so the two never fight over a baked-in height. */
const CONTROL_BASE =
  'w-full rounded-input border border-border bg-surface px-3 py-2.5 text-sm text-textMain ' +
  'transition duration-base ease-smooth ' +
  'placeholder:text-neutral-400 focus:border-primary-400 focus:shadow-focus focus:outline-none ' +
  'disabled:cursor-not-allowed ' +
  // C3 — locked/read-only RESTING look: a filled "document" chip (subtle fill, no input
  // outline, no elevation) instead of a greyed editable box, so a submitted record reads
  // as a DOCUMENT — not a form you could still type into. The fill covers text/textarea
  // consumers that set `readOnly` (which never matches `:disabled`, which is why locked
  // text fields used to get no treatment at all) plus anything that sets `disabled`; the
  // kit Select/DatePicker/Switch triggers are buttons (never `readonly`), so their
  // disabled looks are a separate follow-up. Matched via the `[readonly]` ATTRIBUTE —
  // NOT the `read-only:` variant, because CSS `:read-only` matches every element that
  // isn't `:read-write` (<select>, <div>, …) and permanently "locked" editable consumers
  // like the filter multi-select.
  // Dark: `subtle` sits only ~1.1:1 above `surface`, so a transparent border would vanish
  // there → keep a hairline `borderStrong` edge in dark only.
  'disabled:bg-subtle disabled:border-transparent disabled:shadow-none dark:disabled:border-borderStrong ' +
  '[&[readonly]]:bg-subtle [&[readonly]]:border-transparent [&[readonly]]:shadow-none dark:[&[readonly]]:border-borderStrong';

/** Single-line control chrome: base + the shared control-height floor. `min-h` (not a
 *  fixed height) so a wrapped read-only value still fits and an explicitly taller
 *  variant (e.g. the filter multi-select's `h-24`) still wins. */
export const FIELD_CLASS = CONTROL_BASE + ` min-h-[${CONTROL_H}]`;

/** Textarea-only chrome: base plus the NORDSTERN F4 bounds — resize vertically only,
 *  with sane min/max (the free resize grip reflowed the whole record form). Built from
 *  CONTROL_BASE (not FIELD_CLASS) so the single-line height floor never collides with
 *  the textarea's own min-h. Use ONLY on multi-line <textarea> consumers. */
export const TEXTAREA_CLASS = CONTROL_BASE + ' resize-y min-h-[5.5rem] max-h-[20rem]';

/** Compose aria-describedby from the optional description + error ids. */
export function describedBy(describedById?: string, errorId?: string): string | undefined {
  return [describedById, errorId].filter(Boolean).join(' ') || undefined;
}
