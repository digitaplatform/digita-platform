import { DENSITY_STORAGE_KEY, DESIGN_STORAGE_KEY, MODE_STORAGE_KEY, type Density, type ThemeMode } from './runtime.js';

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
 * Keep the choices the server holds for the signed-in user as this browser's own: each valid
 * value is written under its storage key, where bootIdentity reads it, so the app and the website
 * of one origin show it. A missing or invalid value leaves the browser's own. Returns the valid
 * choices, for a caller that applies them one by one.
 */
export function storeIdentityPreferences(values: Record<keyof IdentityChoices, unknown>): IdentityChoices {
  const stored: IdentityChoices = {};
  const { mode, density, design } = values;
  if (mode === 'light' || mode === 'dark' || mode === 'system') {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    stored.mode = mode;
  }
  if (density === 'comfortable' || density === 'compact' || density === 'spacious') {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
    stored.density = density;
  }
  if (typeof design === 'string' && design) {
    localStorage.setItem(DESIGN_STORAGE_KEY, design);
    stored.design = design;
  }
  return stored;
}
