import { applyBranding } from '../branding/applyBranding.js';

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
}

const simetrix: Signature = {
  id: 'simetrix',
  name: 'Simetrix',
  accent: '#0E6FB8',
  fonts: {
    display: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    sans: "'Manrope', 'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
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
