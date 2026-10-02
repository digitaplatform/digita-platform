import { DEFAULT_SIGNATURE_ID } from '../signatures/index.js';
import { getRuntimeSignature } from '../signatures/runtime-registry.js';

/** The part of a tenant's look that decides how a page is drawn: the `branding` of an app engine's
 *  `GET /api/v1/boot`, the BrandingSetting an Administrator keeps. */
export interface TenantLook {
  default_signature?: string | null;
  allow_user_theme_mode?: boolean | null;
}

/** Where a page keeps the tenant's look it drew last, so its first paint before the look arrives
 *  wears it instead of flashing digita. Each page passes keys of its own: apps of one tenant share
 *  an origin and may wear different looks. Neither key ever holds a person's pick. */
export interface LookCacheKeys {
  signature: string;
  modeLock: string;
}

/**
 * The signature everyone sees, by one rule: once the tenant's look arrived, its default signature
 * if this page offers it; before that, the signature this page drew last (its cache) if it offers
 * it; else digita. A page offers a signature once it is registered: the bundled looks at start, a
 * delivered one later. The look and a delivered signature arrive in any order and each re-runs the
 * rule, so the last of them, which sees every registered signature, decides.
 */
export function drawnSignature(look: TenantLook | null, keys: LookCacheKeys): string {
  const id = look ? look.default_signature : localStorage.getItem(keys.signature);
  return id && getRuntimeSignature(id) ? id : DEFAULT_SIGNATURE_ID;
}

/** Whether the tenant allows no light/dark choice, so everyone follows the system mode; before
 *  the tenant's look arrived, as this page cached it. */
export function isModeLocked(look: TenantLook | null, keys: LookCacheKeys): boolean {
  return look ? look.allow_user_theme_mode === false : localStorage.getItem(keys.modeLock) !== null;
}

/** Cache the signature this page drew, for its next first paint. */
export function cacheDrawnSignature(signature: string, keys: LookCacheKeys): void {
  localStorage.setItem(keys.signature, signature);
}

/** Cache whether the tenant's look locks light/dark, for the next first paint. */
export function cacheModeLock(look: TenantLook, keys: LookCacheKeys): void {
  if (isModeLocked(look, keys)) localStorage.setItem(keys.modeLock, 'locked');
  else localStorage.removeItem(keys.modeLock);
}
