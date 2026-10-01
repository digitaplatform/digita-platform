import { create } from 'zustand';
import type { BootBranding } from '@/types';
import {
  applyMode,
  applyBranding,
  applyDensity,
  applyDesign,
  applySignature,
  bootIdentity,
  getRuntimeSignature,
  storeIdentityPreferences,
  DEFAULT_SIGNATURE_ID,
  IDENTITY_PREFERENCE_KEYS,
  MODE_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  DESIGN_STORAGE_KEY,
  SIGNATURE_STORAGE_KEY,
  type ThemeMode,
  type Density,
} from '@digitaplatform/theme';
import { signature as digitaSignature } from '@digitaplatform/digita';
import { nextMode } from '@digitaplatform/components';
import { getUserPreference, setUserPreference } from '@/services/userPreference';

const TEMPLATE_KEY = 'digita-app:template';

interface ThemeState {
  mode: ThemeMode;
  /** Per-user UI density (comfortable | compact | spacious). */
  density: Density;
  /** Active design id (the token plugin selected via data-design). */
  design: string;
  /** The signature drawn (the identity overlay riding the branding layer — it
   *  COMPOSES on top of the design, never replaces it): always the answer of
   *  drawnSignature, so the menus check the look the person sees. */
  signature: string;
  /** Per-user template override (else resolved from branding.default_template). */
  templateOverride: string | null;
  branding: BootBranding | null;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
  setDensity: (density: Density) => void;
  setDesign: (design: string) => void;
  setSignature: (id: string) => void;
  /** Draw the signature drawnSignature answers now — call after the plugin
   *  composition loads, so a DELIVERED pick or tenant default (registered by the
   *  host loader) replaces the boot-time fallback and its full brand world lands. */
  reapplySignature: () => void;
  setTemplateOverride: (key: string) => void;
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
// digita is the platform's own signature, shipped as a free plugin BUNDLED into
// the host at build (like usermenu) — NOT network-delivered. It is registered
// before the stored id is applied, so getSignature('digita') resolves its full
// brand world on the very first paint, including the pre-login screen, with no
// flash and no dependency on the authenticated plugin composition. Alternate /
// premium signatures still arrive later via the composition.
const initial = bootIdentity({ signatures: [digitaSignature] });

// The signature a person sees, by one rule: their own pick, stored in this browser
// (where a pick roamed from UserPreference is written too), if this app offers it;
// else the tenant's BrandingSetting.default_signature if this app offers it; else
// digita. An app offers a signature once it is registered: digita at start, a
// delivered one when the composition loads. /boot, a roamed pick and the
// composition arrive in any order and each re-runs the rule, so the last of them,
// which sees every registered signature, decides.
function drawnSignature(branding: BootBranding | null): string {
  const offered = [localStorage.getItem(SIGNATURE_STORAGE_KEY), branding?.default_signature].find(
    (id) => getRuntimeSignature(id) !== undefined,
  );
  return offered ?? DEFAULT_SIGNATURE_ID;
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
  templateOverride: localStorage.getItem(TEMPLATE_KEY),
  branding: null,
  setMode: (mode) => {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    applyMode(mode);
    set({ mode });
    void setUserPreference(IDENTITY_PREFERENCE_KEYS.mode, mode).catch(() => {});
  },
  cycleMode: () => get().setMode(nextMode(get().mode)),
  setDensity: (density) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
    applyDensity(density);
    set({ density });
    void setUserPreference(IDENTITY_PREFERENCE_KEYS.density, density).catch(() => {});
  },
  setDesign: (design) => {
    localStorage.setItem(DESIGN_STORAGE_KEY, design);
    applyDesign(design);
    set({ design });
    void setUserPreference(IDENTITY_PREFERENCE_KEYS.design, design).catch(() => {});
  },
  setSignature: (id) => {
    // Picking the signature already drawn stores nothing, so a person who never
    // picked one keeps following the tenant's default when it changes. A stored
    // pick the app does not offer is replaced, or it would return once delivered.
    const stored = localStorage.getItem(SIGNATURE_STORAGE_KEY);
    if (id === get().signature && (stored === null || stored === id)) return;
    localStorage.setItem(SIGNATURE_STORAGE_KEY, id);
    get().reapplySignature();
    void setUserPreference(IDENTITY_PREFERENCE_KEYS.signature, id).catch(() => {});
  },
  reapplySignature: () => {
    const signature = drawnSignature(get().branding);
    applySignatureLayered(signature, get);
    set({ signature });
  },
  setTemplateOverride: (key) => {
    localStorage.setItem(TEMPLATE_KEY, key);
    set({ templateOverride: key });
  },
  // The branding may name another default signature, so the signature is drawn
  // again, and applySignatureLayered puts the tenant's overrides and the per-user
  // density back over it.
  setBranding: (branding) => {
    set({ branding });
    get().reapplySignature();
  },
  loadRemotePrefs: async () => {
    try {
      const [mode, density, design, signature] = await Promise.all([
        getUserPreference(IDENTITY_PREFERENCE_KEYS.mode),
        getUserPreference(IDENTITY_PREFERENCE_KEYS.density),
        getUserPreference(IDENTITY_PREFERENCE_KEYS.design),
        getUserPreference(IDENTITY_PREFERENCE_KEYS.signature),
      ]);
      const stored = storeIdentityPreferences({ mode, density, design, signature });
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
      if (stored.signature) get().reapplySignature();
    } catch {
      /* offline or unset — keep the localStorage default */
    }
  },
}));
