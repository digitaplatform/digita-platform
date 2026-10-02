import { DENSITY_STORAGE_KEY, DESIGN_STORAGE_KEY, MODE_STORAGE_KEY, type Density, type ThemeMode } from './runtime.js';
import { writeLookCookie } from './look-cookie.js';

/** Where the server keeps a user's identity choices, so they roam across devices: the
 *  UserPreference row under each of these keys (value = the choice). */
export const IDENTITY_PREFERENCE_KEYS = {
  mode: 'ui.theme_mode',
  density: 'ui.density',
  design: 'ui.design',
} as const;

/** The identity choices a user can make and keep. */
export interface IdentityChoices {
  mode?: ThemeMode;
  density?: Density;
  design?: string;
}

/**
 * Keep a person's choices as this browser's own and as their look cookie: each choice is written
 * under its storage key, where bootIdentity reads it on this host, and into the cookie, where the
 * tenant's pages on other hosts read it (look-cookie.ts). `cookieDomain` is lookCookieDomain of
 * the tenant's sign-in address. The app's setters call it for one choice at a time.
 */
export function rememberIdentityChoices(choices: IdentityChoices, cookieDomain: string | undefined): void {
  if (choices.mode) localStorage.setItem(MODE_STORAGE_KEY, choices.mode);
  if (choices.density) localStorage.setItem(DENSITY_STORAGE_KEY, choices.density);
  if (choices.design) localStorage.setItem(DESIGN_STORAGE_KEY, choices.design);
  writeLookCookie(choices, cookieDomain);
}

/**
 * Keep the choices the server holds for the signed-in user as this browser's own and as their look
 * cookie (rememberIdentityChoices), so the app and the website of one origin, and the tenant's
 * pages on other hosts, show them. A missing or invalid value leaves the browser's own. Returns the
 * valid choices, for a caller that applies them one by one.
 */
export function storeIdentityPreferences(
  values: Record<keyof IdentityChoices, unknown>,
  cookieDomain: string | undefined,
): IdentityChoices {
  const stored: IdentityChoices = {};
  const { mode, density, design } = values;
  if (mode === 'light' || mode === 'dark' || mode === 'system') stored.mode = mode;
  if (density === 'comfortable' || density === 'compact' || density === 'spacious') stored.density = density;
  if (typeof design === 'string' && design) stored.design = design;
  rememberIdentityChoices(stored, cookieDomain);
  return stored;
}
