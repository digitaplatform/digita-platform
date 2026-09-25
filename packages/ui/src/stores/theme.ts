import { create } from 'zustand';
import type { BootBranding } from '@/types';
import {
  applyMode,
  applyBranding,
  applyDensity,
  applyDesign,
  applySignature,
  bootIdentity,
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

const TEMPLATE_KEY = 'digita-ui:template';
const PREF_MODE = 'ui.theme_mode';
const PREF_DENSITY = 'ui.density';
const PREF_DESIGN = 'ui.design';
const PREF_SIGNATURE = 'ui.signature';

interface ThemeState {
  mode: ThemeMode;
  /** Per-user UI density (comfortable | compact | spacious). */
  density: Density;
  /** Active design id (the token plugin selected via data-design). */
  design: string;
  /** Active signature id (the identity overlay riding the branding layer — it
   *  COMPOSES on top of the design, never replaces it). */
  signature: string;
  /** Per-user template override (else resolved from branding.default_template). */
  templateOverride: string | null;
  branding: BootBranding | null;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
  setDensity: (density: Density) => void;
  setDesign: (design: string) => void;
  setSignature: (id: string) => void;
  /** Re-apply the ACTIVE signature — call after the plugin composition loads so a
   *  DELIVERED signature (registered by the host loader) replaces the boot-time
   *  fallback and its full brand world lands. */
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
// digita is the platform's DEFAULT signature, shipped as a free plugin BUNDLED
// into the host at build (like usermenu) — NOT network-delivered. It is registered
// before the stored id is applied, so getSignature('digita') resolves its full
// brand world on the very first paint, including the pre-login screen, with no
// flash and no dependency on the authenticated plugin composition. Alternate /
// premium signatures still arrive later via the composition.
const initial = bootIdentity({ signatures: [digitaSignature] });

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
  signature: initial.signature,
  templateOverride: localStorage.getItem(TEMPLATE_KEY),
  branding: null,
  setMode: (mode) => {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    applyMode(mode);
    set({ mode });
    void setUserPreference(PREF_MODE, mode).catch(() => {});
  },
  cycleMode: () => get().setMode(nextMode(get().mode)),
  setDensity: (density) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
    applyDensity(density);
    set({ density });
    void setUserPreference(PREF_DENSITY, density).catch(() => {});
  },
  setDesign: (design) => {
    localStorage.setItem(DESIGN_STORAGE_KEY, design);
    applyDesign(design);
    set({ design });
    void setUserPreference(PREF_DESIGN, design).catch(() => {});
  },
  setSignature: (id) => {
    localStorage.setItem(SIGNATURE_STORAGE_KEY, id);
    applySignatureLayered(id, get);
    set({ signature: id });
    void setUserPreference(PREF_SIGNATURE, id).catch(() => {});
  },
  reapplySignature: () => applySignatureLayered(get().signature, get),
  setTemplateOverride: (key) => {
    localStorage.setItem(TEMPLATE_KEY, key);
    set({ templateOverride: key });
  },
  // Apply branding overrides (secondary/accent palette, primary nearest-match)
  // through the central runtime; the per-user density wins over any branding
  // default, so re-assert it after.
  setBranding: (branding) => {
    applyBranding(branding);
    applyDensity(get().density);
    set({ branding });
  },
  loadRemotePrefs: async () => {
    try {
      const [mode, density, design, signature] = await Promise.all([
        getUserPreference<ThemeMode>(PREF_MODE),
        getUserPreference<Density>(PREF_DENSITY),
        getUserPreference<string>(PREF_DESIGN),
        getUserPreference<string>(PREF_SIGNATURE),
      ]);
      if (mode === 'light' || mode === 'dark' || mode === 'system') {
        localStorage.setItem(MODE_STORAGE_KEY, mode);
        applyMode(mode);
        set({ mode });
      }
      if (density === 'comfortable' || density === 'compact' || density === 'spacious') {
        localStorage.setItem(DENSITY_STORAGE_KEY, density);
        applyDensity(density);
        set({ density });
      }
      if (typeof design === 'string' && design) {
        localStorage.setItem(DESIGN_STORAGE_KEY, design);
        applyDesign(design);
        set({ design });
      }
      if (typeof signature === 'string' && signature) {
        localStorage.setItem(SIGNATURE_STORAGE_KEY, signature);
        applySignatureLayered(signature, get);
        set({ signature });
      }
    } catch {
      /* offline or unset — keep the localStorage default */
    }
  },
}));
