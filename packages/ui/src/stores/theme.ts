import { create } from 'zustand';
import type { BootBranding } from '@/types';
import {
  applyMode,
  applyBranding,
  applyDensity,
  applyDesign,
  applySignature,
  resolveInitialMode,
  resolveInitialDensity,
  resolveInitialDesign,
  resolveInitialSignature,
  type ThemeMode,
  type Density,
} from '@digitaplatform/theme';
import { getUserPreference, setUserPreference } from '@/services/userPreference';

const MODE_KEY = 'digita-ui:theme-mode';
const TEMPLATE_KEY = 'digita-ui:template';
const DENSITY_KEY = 'digita-ui:density';
const DESIGN_KEY = 'digita-ui:design';
const SIGNATURE_KEY = 'digita-ui:signature';
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

// Mode + density + branding are applied by @digitaplatform/theme's framework-agnostic
// runtime; this store only owns React state. Pre-mount set avoids a flash;
// localStorage is the fast device-local default until the server prefs roam in.
const initialMode = resolveInitialMode(MODE_KEY);
const initialDensity = resolveInitialDensity(DENSITY_KEY);
const initialDesign = resolveInitialDesign(DESIGN_KEY);
applyDesign(initialDesign);
applyMode(initialMode);
applyDensity(initialDensity);
// Signature LAST: its accent/fonts (and, for a full signature, the brand colour
// world + graphics) ride the branding layer (inline vars), which composes ON TOP
// of the design stamp — 'digita' (the platform's own identity) paints by default.
const initialSignature = resolveInitialSignature(SIGNATURE_KEY);
applySignature(initialSignature);

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  density: initialDensity,
  design: initialDesign,
  signature: initialSignature,
  templateOverride: localStorage.getItem(TEMPLATE_KEY),
  branding: null,
  setMode: (mode) => {
    localStorage.setItem(MODE_KEY, mode);
    applyMode(mode);
    set({ mode });
    void setUserPreference(PREF_MODE, mode).catch(() => {});
  },
  cycleMode: () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    get().setMode(order[(order.indexOf(get().mode) + 1) % order.length]!);
  },
  setDensity: (density) => {
    localStorage.setItem(DENSITY_KEY, density);
    applyDensity(density);
    set({ density });
    void setUserPreference(PREF_DENSITY, density).catch(() => {});
  },
  setDesign: (design) => {
    localStorage.setItem(DESIGN_KEY, design);
    applyDesign(design);
    set({ design });
    void setUserPreference(PREF_DESIGN, design).catch(() => {});
  },
  setSignature: (id) => {
    localStorage.setItem(SIGNATURE_KEY, id);
    applySignature(id);
    set({ signature: id });
    void setUserPreference(PREF_SIGNATURE, id).catch(() => {});
  },
  reapplySignature: () => applySignature(get().signature),
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
        localStorage.setItem(MODE_KEY, mode);
        applyMode(mode);
        set({ mode });
      }
      if (density === 'comfortable' || density === 'compact' || density === 'spacious') {
        localStorage.setItem(DENSITY_KEY, density);
        applyDensity(density);
        set({ density });
      }
      if (typeof design === 'string' && design) {
        localStorage.setItem(DESIGN_KEY, design);
        applyDesign(design);
        set({ design });
      }
      if (typeof signature === 'string' && signature) {
        localStorage.setItem(SIGNATURE_KEY, signature);
        applySignature(signature);
        set({ signature });
      }
    } catch {
      /* offline or unset — keep the localStorage default */
    }
  },
}));
