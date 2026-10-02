import { create } from 'zustand';
import type { BootBranding } from '@/types';
import {
  applyMode,
  applyBranding,
  applyDensity,
  applyDesign,
  applySignature,
  bootIdentity,
  cacheDrawnSignature,
  cacheModeLock,
  drawnSignature as drawnLookSignature,
  isModeLocked as isLookModeLocked,
  lookCookieDomain,
  rememberIdentityChoices,
  resolveInitialDensity,
  resolveInitialMode,
  storeIdentityPreferences,
  IDENTITY_PREFERENCE_KEYS,
  type LookCacheKeys,
  type ThemeMode,
  type Density,
} from '@digitaplatform/theme';
import { signature as digitaSignature } from '@digitaplatform/digita';
import { signature as simetrixSignature } from '@digitaplatform/simetrix';
import { signature as veloluckLakeside } from '@digitaplatform/veloluck-lakeside';
import { signature as veloluckPrecise } from '@digitaplatform/veloluck-precise';
import { signature as veloluckWorkbench } from '@digitaplatform/veloluck-workbench';
import { nextMode } from '@digitaplatform/components';
import faviconUrl from '@digitaplatform/theme/favicon.svg?no-inline';
import { getUserPreference, setUserPreference } from '@/services/userPreference';
import { APP_BASE_PATH, appUrl } from '@/lib/appBase';
import { AUTH_URL } from '@/lib/authConfig';

// The tenant's look this app drew last in this browser, kept only as a CACHE so the first paint,
// before /boot answers, wears it instead of flashing digita: the signature, and whether light/dark
// is locked. Neither is a person's pick. Apps of one tenant share the origin and may wear
// different looks, so each app caches its own under its base path.
const LOOK_CACHE_KEYS: LookCacheKeys = {
  signature: `digita-app:signature-cache${APP_BASE_PATH}`,
  modeLock: `digita-app:mode-lock${APP_BASE_PATH}`,
};

// The Domain of the person's look cookie, which carries their choices to the tenant's sign-in
// pages, report designer and website on other hosts.
const LOOK_COOKIE_DOMAIN = lookCookieDomain(AUTH_URL);

interface ThemeState {
  mode: ThemeMode;
  /** Per-user UI density (comfortable | compact | spacious). */
  density: Density;
  /** Active design id (the token plugin selected via data-design). */
  design: string;
  /** The signature drawn (the identity overlay riding the branding layer — it
   *  COMPOSES on top of the design, never replaces it): the answer of
   *  drawnSignature, or a look the design showcase previews. */
  signature: string;
  branding: BootBranding | null;
  /** Whether mode, density and design roam with the person through UserPreference. Not on a
   *  demo session: every visitor shares its user, so a visitor's pick stays on their device. */
  roams: boolean;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
  setDensity: (density: Density) => void;
  setDesign: (design: string) => void;
  /** Draw signature `id` on this page until the next draw, for the design
   *  showcase: nothing is cached or stored, so the tenant's look returns. */
  previewSignature: (id: string) => void;
  /** Draw the signature drawnSignature answers now and cache it — call after the
   *  plugin composition loads, so a DELIVERED tenant default (registered by the
   *  host loader) replaces the boot-time fallback and its full brand world lands. */
  reapplySignature: () => void;
  setBranding: (branding: BootBranding) => void;
  /** Pull mode + density + design from UserPreference (server) so they roam across
   *  devices. Called once authenticated; the server value wins over the localStorage
   *  default. */
  loadRemotePrefs: () => Promise<void>;
}

// Design, mode, signature and density are applied by @digitaplatform/theme's
// framework-agnostic runtime — bootIdentity, the same function the website runs
// before its first paint; this store only owns React state. Pre-mount set avoids a
// flash; localStorage is the fast device-local default until the server prefs roam
// in. The branding follows when /boot answers (setBranding).
//
// The five looks the website renderer bundles (packages/web/src/lib/identity.ts)
// ship BUNDLED into the host at build too (like usermenu), NOT network-delivered,
// so a tenant's BrandingSetting.default_signature can name any of them: digita,
// the platform's own, simetrix, and the three Veloluck looks. They are registered
// before the stored id is applied, so each resolves its full brand world on the
// very first paint, including the pre-login screen, with no flash and no
// dependency on the authenticated plugin composition. Other signatures still
// arrive later via the composition.
const initial = bootIdentity({
  signatures: [digitaSignature, simetrixSignature, veloluckWorkbench, veloluckLakeside, veloluckPrecise],
  signature: localStorage.getItem(LOOK_CACHE_KEYS.signature) ?? undefined,
  mode: isLookModeLocked(null, LOOK_CACHE_KEYS) ? 'system' : undefined,
});

/** Whether the tenant allows no light/dark choice: its branding says so once /boot answered,
 *  the cache before. */
export function isModeLocked(branding: BootBranding | null): boolean {
  return isLookModeLocked(branding, LOOK_CACHE_KEYS);
}

// The signature everyone sees, by the rule the tenant's other pages draw by too (drawnSignature of
// @digitaplatform/theme).
function drawnSignature(branding: BootBranding | null): string {
  return drawnLookSignature(branding, LOOK_CACHE_KEYS);
}

// The page's icon: the tenant's favicon, else the platform's, which main.tsx puts in place at
// start. One link element is kept, so a branding without a favicon puts the platform's back.
function showFavicon(href: string): void {
  const link =
    document.head.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
    document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  link.removeAttribute('type');
  link.setAttribute('href', href);
}

// Apply signature `id`, then re-assert the tenant's branding on top: a tenant's
// configured primary colour / fonts WIN over the signature's defaults, and the
// per-user density is re-asserted too. Every store path that (re)applies the
// signature goes through here, so the layering — design < signature < tenant
// branding — is identical everywhere and a re-apply (e.g. after the composition
// loads) never leaves the signature stomping a tenant's brand.
function applySignatureLayered(id: string, get: () => ThemeState): void {
  applySignature(id);
  const branding = get().branding;
  if (branding) applyBranding(branding);
  applyDensity(get().density);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initial.mode,
  density: initial.density,
  design: initial.design,
  signature: drawnSignature(null),
  branding: null,
  roams: true,
  setMode: (mode) => {
    if (isModeLocked(get().branding)) return;
    rememberIdentityChoices({ mode }, LOOK_COOKIE_DOMAIN);
    applyMode(mode);
    set({ mode });
    if (get().roams) void setUserPreference(IDENTITY_PREFERENCE_KEYS.mode, mode).catch(() => {});
  },
  cycleMode: () => get().setMode(nextMode(get().mode)),
  setDensity: (density) => {
    rememberIdentityChoices({ density }, LOOK_COOKIE_DOMAIN);
    applyDensity(density);
    set({ density });
    if (get().roams) void setUserPreference(IDENTITY_PREFERENCE_KEYS.density, density).catch(() => {});
  },
  setDesign: (design) => {
    rememberIdentityChoices({ design }, LOOK_COOKIE_DOMAIN);
    applyDesign(design);
    set({ design });
    if (get().roams) void setUserPreference(IDENTITY_PREFERENCE_KEYS.design, design).catch(() => {});
  },
  previewSignature: (id) => {
    applySignatureLayered(id, get);
    set({ signature: id });
  },
  reapplySignature: () => {
    const signature = drawnSignature(get().branding);
    applySignatureLayered(signature, get);
    cacheDrawnSignature(signature, LOOK_CACHE_KEYS);
    set({ signature });
  },
  // The branding may name another default signature, so the signature is drawn
  // again, and applySignatureLayered puts the tenant's overrides and the density
  // back over it: a person's own density, else the tenant's. A tenant that allows
  // no light/dark choice puts everyone on the system mode.
  setBranding: (branding) => {
    const wasModeLocked = isModeLocked(get().branding);
    const isNowModeLocked = isModeLocked(branding);
    cacheModeLock(branding, LOOK_CACHE_KEYS);
    // Under the lock everyone follows the system mode; when it lifts, a person's own mode returns.
    const mode = isNowModeLocked ? 'system' : wasModeLocked ? resolveInitialMode() : get().mode;
    if (mode !== get().mode || isNowModeLocked !== wasModeLocked) applyMode(mode);
    set({ branding, density: resolveInitialDensity(undefined, branding.density), mode });
    showFavicon(branding.favicon ? appUrl(branding.favicon) : faviconUrl);
    get().reapplySignature();
  },
  loadRemotePrefs: async () => {
    try {
      const [mode, density, design] = await Promise.all([
        getUserPreference(IDENTITY_PREFERENCE_KEYS.mode),
        getUserPreference(IDENTITY_PREFERENCE_KEYS.density),
        getUserPreference(IDENTITY_PREFERENCE_KEYS.design),
      ]);
      // Under the lock a roamed mode is not kept, or it would paint the next load's first frame.
      const isLocked = isModeLocked(get().branding);
      const stored = storeIdentityPreferences({ mode: isLocked ? undefined : mode, density, design }, LOOK_COOKIE_DOMAIN);
      if (stored.mode) {
        applyMode(stored.mode);
        set({ mode: stored.mode });
      }
      if (stored.density) {
        applyDensity(stored.density);
        set({ density: stored.density });
      }
      if (stored.design) {
        applyDesign(stored.design);
        set({ design: stored.design });
      }
    } catch {
      /* offline or unset — keep the localStorage default */
    }
  },
}));
