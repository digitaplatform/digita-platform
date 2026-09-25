/** The decorative layers a signature carries (the theme's `Signature['graphics']`),
 *  keyed grid, glow, band, card, panel; only whether a key exists matters here. */
export type SignatureBackdropGraphics = Partial<Record<string, unknown>>;

/**
 * The signature's decorative backdrop — the `grid` + `glow` layers of a FULL
 * signature (e.g. digita), painted behind a whole app shell or page. A thin
 * signature (no `graphics`) renders nothing, so switching to one simply drops it.
 *
 * The layers read the signature's `--sig-<key>-l` / `--sig-<key>-d` CSS values
 * (gradients can't use light-dark()), resolving the light value by default and
 * the dark value under the runtime's `.dark` class — so mode flips repaint with
 * pure CSS, no re-render. Place it first inside a `relative isolate` container:
 * at `-z-10` it sits above that container's base canvas and below every region
 * (opaque regions cover it; transparent ones let the grid + glow show through).
 */
export function SignatureBackdrop({ graphics }: { graphics: SignatureBackdropGraphics | null | undefined }) {
  if (!graphics) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" data-testid="signature-backdrop">
      {/* The layers are the signature's REAL background vectors (data-URI SVGs):
          the grid tiles at its intrinsic size (40px pattern baked into the file);
          the glow is ONE top-anchored panel scaled to the page width. */}
      {graphics.grid ? (
        <div className="absolute inset-0 bg-[image:var(--sig-grid-l)] dark:bg-[image:var(--sig-grid-d)]" />
      ) : null}
      {graphics.glow ? (
        <div className="absolute inset-0 bg-[image:var(--sig-glow-l)] bg-[length:100%_auto] bg-top bg-no-repeat dark:bg-[image:var(--sig-glow-d)]" />
      ) : null}
    </div>
  );
}
