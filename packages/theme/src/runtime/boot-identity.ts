import {
  applyBranding,
  applyDensity,
  applyDesign,
  applyMode,
  paintMode,
  resolveInitialDensity,
  resolveInitialDesign,
  resolveInitialMode,
  type BrandingInput,
  type Density,
  type ThemeMode,
} from './runtime.js';
import { applySignature, resolveInitialSignature, type Signature } from '../signatures/index.js';
import { registerSignature } from '../signatures/runtime-registry.js';

/** The choices bootIdentity resolved from what this browser stored. */
export interface BootedIdentity {
  design: string;
  mode: ThemeMode;
  signature: string;
  density: Density;
}

export interface BootIdentityOptions {
  /** Registered before the stored or default signature id is resolved, so it lands
   *  with its full identity (the app and the website bundle the default one). */
  signatures?: readonly Signature[];
  /** The tenant's branding, when the caller has it at boot (the website's server
   *  read it); the app applies it later, when /boot answers. */
  branding?: BrandingInput | null;
  /** false: set the mode class once and leave following the OS to the page's own
   *  runtime (a pre-paint script); default true. */
  followSystemMode?: boolean;
  target?: HTMLElement;
}

/**
 * Put a page into the identity this browser chose, in the order the layers
 * compose: the design (with its variant and the tint picked for it), the mode, the
 * signature, the tenant's branding over the signature, and the density last —
 * the signature's teardown clears it, and a stored density beats the branding's.
 * The app runs it when its theme store initialises; the website runs the same
 * function before first paint. App and website share one origin, so one choice
 * made in either shows in both.
 */
export function bootIdentity(options: BootIdentityOptions = {}): BootedIdentity {
  const target = options.target ?? document.documentElement;
  for (const signature of options.signatures ?? []) registerSignature(signature);
  const design = resolveInitialDesign();
  applyDesign(design, target);
  const mode = resolveInitialMode();
  if (options.followSystemMode === false) paintMode(mode, target);
  else applyMode(mode, target);
  const signature = resolveInitialSignature();
  applySignature(signature, target);
  if (options.branding) applyBranding(options.branding, target);
  const density = resolveInitialDensity();
  applyDensity(density, target);
  return { design, mode, signature, density };
}

/** The id of the <script type="application/json"> a server-rendered page writes its
 *  identity data into: { signatures, branding }, the options its pre-paint boot runs with. */
export const PAGE_IDENTITY_ELEMENT_ID = 'digita-identity';

/** The identity data this server-rendered page carries, or null on a page without it. */
export function readPageIdentity(doc: Document = document): Pick<BootIdentityOptions, 'signatures' | 'branding'> | null {
  return JSON.parse(doc.getElementById(PAGE_IDENTITY_ELEMENT_ID)?.textContent || 'null') as Pick<
    BootIdentityOptions,
    'signatures' | 'branding'
  > | null;
}
