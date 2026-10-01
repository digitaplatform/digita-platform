import {
  applyBranding,
  applyDensity,
  applyDesign,
  applyMode,
  moveFormerStorageKeys,
  paintMode,
  resolveInitialDensity,
  resolveInitialDesign,
  resolveInitialMode,
  type BrandingInput,
  type Density,
  type ThemeMode,
} from './runtime.js';
import { applySignature, DEFAULT_SIGNATURE_ID, removeFormerSignaturePick, type Signature } from '../signatures/index.js';
import { registerSignature } from '../signatures/runtime-registry.js';

/** The choices bootIdentity applied: what this browser stored, and the signature it was given. */
export interface BootedIdentity {
  design: string;
  mode: ThemeMode;
  signature: string;
  density: Density;
}

export interface BootIdentityOptions {
  /** Registered before the signature is applied, so the given signature lands with its
   *  full identity (the website bundles the site's signatures, the app the looks a tenant
   *  may name). */
  signatures?: readonly Signature[];
  /** The signature the page is drawn in, applied as it is; without one, the default. A
   *  website's signature is the site's identity (its `theme`), the app's the tenant's look
   *  it drew last; neither is a choice of the visitor. */
  signature?: string;
  /** The mode the page is drawn in, applied as it is; without one, the mode this browser
   *  stored. The app passes `system` while its tenant allows no light/dark choice. */
  mode?: ThemeMode;
  /** The tenant's branding, when the caller has it at boot (the website's server
   *  read it); the app applies it later, when /boot answers. */
  branding?: BrandingInput | null;
  /** false: set the mode class once and leave following the OS to the page's own
   *  runtime (a pre-paint script); default true. */
  followSystemMode?: boolean;
  target?: HTMLElement;
}

/**
 * Put a page into its identity: the signature it is given, and the design, mode and
 * density this browser chose, in the order the
 * layers compose: the design (with its variant and the tint picked for it), the mode, the
 * signature, the tenant's branding over the signature, and the density last —
 * the signature's teardown clears it, and a stored density beats the branding's, which
 * beats the pointer default.
 * The app runs it when its theme store initialises; the website runs the same
 * function before first paint. App and website share one origin, so a design, mode or
 * density chosen in either shows in both.
 */
export function bootIdentity(options: BootIdentityOptions = {}): BootedIdentity {
  const target = options.target ?? document.documentElement;
  moveFormerStorageKeys();
  removeFormerSignaturePick();
  for (const signature of options.signatures ?? []) registerSignature(signature);
  const design = resolveInitialDesign();
  applyDesign(design, target);
  const mode = options.mode ?? resolveInitialMode();
  if (options.followSystemMode === false) paintMode(mode, target);
  else applyMode(mode, target);
  const signature = options.signature ?? DEFAULT_SIGNATURE_ID;
  applySignature(signature, target);
  if (options.branding) applyBranding(options.branding, target);
  const density = resolveInitialDensity(undefined, options.branding?.density);
  applyDensity(density, target);
  return { design, mode, signature, density };
}

/** The id of the <script type="application/json"> a server-rendered page writes its
 *  identity data into: { signature, signatures, branding }, the options its pre-paint boot runs with. */
export const PAGE_IDENTITY_ELEMENT_ID = 'digita-identity';

export type PageIdentity = Pick<BootIdentityOptions, 'signature' | 'signatures' | 'branding'>;

/** The identity data this server-rendered page carries, or null on a page without it. */
export function readPageIdentity(doc: Document = document): PageIdentity | null {
  return JSON.parse(doc.getElementById(PAGE_IDENTITY_ELEMENT_ID)?.textContent || 'null') as PageIdentity | null;
}
