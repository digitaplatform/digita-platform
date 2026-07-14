import { applyBranding } from '../runtime/runtime.js';

/**
 * SIGNATURES — built-in identity overlays. A signature is NOT a design: it is a
 * brand identity (accent color + font stacks + optional logo) that rides the
 * BRANDING layer (inline --color-primary-* / --font-* vars), so it COMPOSES on
 * top of whatever design skin is active. Apply it ALONGSIDE `data-design`, not
 * instead of it — flipping the design keeps the signature, and vice versa.
 * (The accent hex currently snaps to the nearest accent palette inside
 * applyBranding — the exact-ramp-from-hex upgrade is a documented TODO there.)
 */
export interface Signature {
  id: string;
  name: string;
  accent: string;
  fonts?: { display?: string; sans?: string; mono?: string };
  logoUrl?: string;
  /** Self-contained inline SVG string for the brand mark: `fill="currentColor"`
   *  (inherits the accent via CSS `color`), viewBox preserved, NO width/height —
   *  the consumer sizes it via CSS. Used by the shell as the default-brand
   *  monogram when the tenant has not set a logo. */
  monogram?: string;
}

// The simetrix "X" monogram, extracted from the marketing site's inline
// <symbol id="csx"> (viewBox 0 0 407 556) — hand-drawn strokes forming the X.
const SIMETRIX_MONOGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 407 556" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M272.5 3L276.5 3L275.5 8L217 221.5L205.5 189ZM309.5 3L313 2.5L313.5 5L265.5 183L235 213.5ZM235.5 10L236.5 14L197.5 160L196 162.5L179 161.5L229.5 20ZM345.5 11L348 10.5L348.5 14L309.5 160L291 161.5ZM193.5 26L194.5 30L160.5 160L142 161.5L188.5 33ZM377.5 27L380.5 30L346.5 161L328 161.5ZM140.5 163L148.5 180L151.5 195L130.5 275L104.5 346L74 376.5L98.5 276ZM344.5 165L317.5 274L276 383.5L265.5 351L285.5 275L315.5 194ZM159.5 215L173.5 249L168.5 270L162.5 287L125 324.5L136.5 277ZM292.5 217L293.5 220L279.5 273L257 331.5L243.5 295L247.5 280L257.5 252ZM241.5 269L239 280.5L236.5 274ZM199.5 324L211.5 353L211.5 358L145.5 542L143.5 547L140 547.5ZM183.5 327L185.5 327L106.5 547L103 547.5L152.5 359ZM220.5 383L222.5 383L226 393.5L235.5 395L183.5 538L180 540.5L179.5 536ZM124.5 387L124.5 392L72.5 535L68 539.5L105.5 394L118 393.5ZM68.5 394L86.5 394L38 523.5L35.5 520ZM254.5 394L272.5 395L227.5 517L222 524.5Z"/></svg>';

const simetrix: Signature = {
  id: 'simetrix',
  name: 'Simetrix',
  accent: '#0E6FB8',
  fonts: {
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    sans: "'Manrope', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
  monogram: SIMETRIX_MONOGRAM,
};

export const SIGNATURES: Record<string, Signature> = { simetrix };

export const DEFAULT_SIGNATURE_ID = 'simetrix';

export const SIGNATURE_LIST = Object.values(SIGNATURES).map((s) => ({ id: s.id, name: s.name }));

export function getSignature(id: string | null | undefined): Signature {
  return (id != null && SIGNATURES[id]) || SIGNATURES[DEFAULT_SIGNATURE_ID]!;
}

/** Apply a signature's identity (accent + fonts) via the branding layer. */
export function applySignature(
  id: string | null | undefined,
  target: HTMLElement = document.documentElement,
): void {
  const s = getSignature(id);
  applyBranding({ primary_color: s.accent, fonts: s.fonts }, target);
}

/** Initial signature from localStorage, validated against SIGNATURES; else the default. */
export function resolveInitialSignature(keyPrefix = 'digita-ui:signature'): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(keyPrefix) : null;
    if (stored && stored in SIGNATURES) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_SIGNATURE_ID;
}
