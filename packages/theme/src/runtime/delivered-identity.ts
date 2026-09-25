import { applyDesign } from './runtime.js';
import { registerDesign } from '../designs/runtime-registry.js';
import { registerSignature } from '../signatures/runtime-registry.js';
import type { SignatureValue } from '../signatures/index.js';

/** A design a plugin delivers: the values it writes on <html> and its stylesheet. */
export interface DeliveredDesign {
  designId: string;
  variant: string;
  cssUrl: string;
  title?: string;
}

/**
 * Load a delivered design: inject its stylesheet once (marker: the
 * data-design-plugin attribute), then register it so applyDesign and the design
 * pickers know it. When it is the ACTIVE design (a stored pick applied before the
 * plugin arrived), the variant stamp was resolved without the registry, so it is
 * re-applied. Rejects, removing the dead link, when the stylesheet fails to load:
 * a broken design never registers.
 */
export async function loadDeliveredDesign(
  design: DeliveredDesign,
  target: HTMLElement = document.documentElement,
): Promise<void> {
  await injectDesignStylesheet(design);
  registerDesign(design.designId, design.variant, { name: design.title ?? design.designId });
  if (target.getAttribute('data-design') === design.designId) applyDesign(design.designId, target);
}

function injectDesignStylesheet(design: DeliveredDesign): Promise<void> {
  return new Promise((resolve, reject) => {
    const injected = [...document.head.querySelectorAll('link[data-design-plugin]')];
    if (injected.some((link) => link.getAttribute('data-design-plugin') === design.designId)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = design.cssUrl;
    link.setAttribute('data-design-plugin', design.designId);
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error(`stylesheet failed to load: ${design.cssUrl}`));
    };
    document.head.appendChild(link);
  });
}

/** A signature a plugin delivers: its identity config, as the plugin inventory carries it. */
export interface DeliveredSignature {
  id: string;
  title?: string;
  accent?: string;
  fonts?: { display?: string; sans?: string; mono?: string };
  logoUrl?: string;
  monogram?: string;
  wordmark?: string;
  colors?: Record<string, SignatureValue>;
  graphics?: Record<string, SignatureValue>;
}

/**
 * Register a delivered signature so getSignature(id) resolves its full identity:
 * accent, fonts, colour world, graphics, monogram and wordmark. A thin signature
 * carries no colours or graphics. Applying it (signature, then the tenant's
 * branding, then density) stays with the caller.
 */
export function registerDeliveredSignature(signature: DeliveredSignature): void {
  registerSignature({
    id: signature.id,
    name: signature.title ?? signature.id,
    accent: signature.accent ?? '',
    fonts: signature.fonts,
    logoUrl: signature.logoUrl,
    monogram: signature.monogram,
    wordmark: signature.wordmark,
    colors: signature.colors,
    graphics: signature.graphics,
  });
}
