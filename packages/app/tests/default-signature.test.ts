// @vitest-environment jsdom
// The signature a person sees, through the boot App() runs: the first paint wears the look this
// app drew last, /boot answers with the tenant's branding, and the plugin composition registers
// the signatures a plugin delivers. Each case loads the stores and the theme's signature registry
// afresh, so no case sees a signature another case registered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInventory } from '@digitaplatform/plugins';
import type { BootBranding, BootData } from '@/types';

const services = vi.hoisted(() => ({
  getBoot: vi.fn(),
  getPluginManifest: vi.fn(),
  getUserPreference: vi.fn(),
  setUserPreference: vi.fn(),
}));
vi.mock('@/services/boot', () => ({ getBoot: services.getBoot }));
vi.mock('@/services/plugins', () => ({ getPluginManifest: services.getPluginManifest }));
vi.mock('@/services/userPreference', () => ({
  getUserPreference: services.getUserPreference,
  setUserPreference: services.setUserPreference,
}));

// The look this app drew last, cached so the first paint wears it; and the key a person's own
// pick was kept under before the tenant's look replaced it.
const CACHE_KEY = 'digita-app:signature-cache';
const FORMER_PICK_KEY = 'digita-app:signature';
const YARD = '#B8541E';

// What the image stages from plugins.lock.json: two full looks of one company, neither of them
// one of the looks the app bundles. A full signature carries a colour world and graphics, and
// only a full one stamps data-signature.
const look = (id: string, accent: string) => ({
  id,
  type: 'signature' as const,
  tier: 'free' as const,
  version: '0.3.7',
  accent,
  colors: { bg: { light: '#FBF7F2', dark: '#16120F' } },
  graphics: { glow: { light: 'none', dark: 'none' } },
});
const inventory: PluginInventory = {
  schemaVersion: 1,
  plugins: [look('harbor-yard', YARD), look('harbor-dock', '#1F7A5C')],
};

function bootData(branding: BootBranding): BootData {
  return {
    user: { _id: 'staff@harbor.test', email: 'staff@harbor.test', roles: ['System User'] },
    locale: { code: 'en' },
    available_languages: [],
    system_settings: { platform_name: 'Digita Platform', default_currency: null, allow_user_language: true, timezone: 'UTC' },
    branding,
  };
}

/** Load the stores and the theme afresh, as a page load does, with /boot answering `branding`. */
async function loadApp(branding: BootBranding) {
  vi.resetModules();
  services.getBoot.mockResolvedValue({ success: true, data: bootData(branding) });
  const theme = await import('@digitaplatform/theme');
  const { useThemeStore } = await import('@/stores/theme');
  const { useSessionStore } = await import('@/stores/session');
  const { loadAppComposition } = await import('@/plugins/composition');
  const { registerBuiltinTemplates } = await import('@/templates/template-registry');
  registerBuiltinTemplates();
  return { theme, useThemeStore, bootstrap: () => useSessionStore.getState().bootstrap(), loadAppComposition };
}

const drawn = () => document.documentElement.getAttribute('data-signature');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-signature');
  document.documentElement.removeAttribute('style');
  services.getUserPreference.mockResolvedValue(undefined);
  services.setUserPreference.mockResolvedValue(undefined);
  services.getPluginManifest.mockResolvedValue({
    success: true,
    data: {
      plugins: [{ id: 'harbor-yard' }, { id: 'harbor-dock' }],
      layout: { template: 'classic', regions: {} },
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(inventory))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the signature a person sees', () => {
  it("the app draws the tenant's default signature once the composition registers it", async () => {
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('harbor-yard');
    expect(drawn()).toBe('harbor-yard');
    expect(document.documentElement.style.getPropertyValue('--color-primary-600')).toBe(
      app.theme.brandingStyle({ primary_color: YARD }).properties['--color-primary-600'],
    );
  });

  it('a changed default reaches everyone at the next draw, and no signature roams', async () => {
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setBranding({ default_signature: 'harbor-dock' });
    expect(app.useThemeStore.getState().signature).toBe('harbor-dock');
    expect(services.setUserPreference).not.toHaveBeenCalled();
    expect(services.getUserPreference).not.toHaveBeenCalledWith('ui.signature');
  });

  it('a pick a person made before is dropped and no longer overrides the tenant default', async () => {
    localStorage.setItem(FORMER_PICK_KEY, 'harbor-dock');
    services.getUserPreference.mockImplementation(async (key: string) =>
      key === 'ui.signature' ? 'harbor-dock' : undefined,
    );
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');
    await app.useThemeStore.getState().loadRemotePrefs();

    expect(app.useThemeStore.getState().signature).toBe('harbor-yard');
    expect(drawn()).toBe('harbor-yard');
    expect(localStorage.getItem(FORMER_PICK_KEY)).toBeNull();
  });

  it('the first paint wears the look this app drew last, before /boot answers', async () => {
    localStorage.setItem(CACHE_KEY, 'veloluck-lakeside');
    const app = await loadApp({ default_signature: 'veloluck-workbench' });

    expect(app.useThemeStore.getState().signature).toBe('veloluck-lakeside');
    expect(drawn()).toBe('veloluck-lakeside');
  });

  it('/boot replaces a stale cached look with the tenant default and caches the default', async () => {
    localStorage.setItem(CACHE_KEY, 'veloluck-lakeside');
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();

    expect(app.useThemeStore.getState().signature).toBe('veloluck-workbench');
    expect(drawn()).toBe('veloluck-workbench');
    expect(localStorage.getItem(CACHE_KEY)).toBe('veloluck-workbench');
  });

  it('a composition that arrives before /boot keeps the cached look instead of drawing digita', async () => {
    localStorage.setItem(CACHE_KEY, 'veloluck-lakeside');
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.loadAppComposition('internal');

    expect(drawn()).toBe('veloluck-lakeside');
    await app.bootstrap();
    expect(drawn()).toBe('veloluck-workbench');
  });

  it('each app of the origin keeps its own cache under its base path', async () => {
    const page = window as unknown as Record<string, unknown>;
    page.__APP_BASE_PATH__ = '/workshop';
    try {
      localStorage.setItem(CACHE_KEY, 'veloluck-lakeside');
      const app = await loadApp({ default_signature: 'veloluck-workbench' });

      expect(drawn()).toBe('digita');
      await app.bootstrap();
      expect(localStorage.getItem(`${CACHE_KEY}/workshop`)).toBe('veloluck-workbench');
      expect(localStorage.getItem(CACHE_KEY)).toBe('veloluck-lakeside');
    } finally {
      delete page.__APP_BASE_PATH__;
    }
  });

  it('a cached look the app does not offer draws digita until /boot answers, then the tenant default', async () => {
    localStorage.setItem(CACHE_KEY, 'aurora');
    const app = await loadApp({ default_signature: 'harbor-yard' });
    expect(app.useThemeStore.getState().signature).toBe('digita');
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('harbor-yard');
    expect(drawn()).toBe('harbor-yard');
  });

  it('without a tenant default, digita stays, also over a look cached before the tenant dropped it', async () => {
    localStorage.setItem(CACHE_KEY, 'veloluck-lakeside');
    const app = await loadApp({});
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('digita');
    expect(drawn()).toBe('digita');
    expect(localStorage.getItem(CACHE_KEY)).toBe('digita');
  });
});

describe('the looks the app bundles', () => {
  it.each(['digita', 'simetrix', 'veloluck-workbench', 'veloluck-lakeside', 'veloluck-precise'])(
    'a tenant default of %s is drawn though no plugin delivers it',
    async (id) => {
      services.getPluginManifest.mockResolvedValue({
        success: true,
        data: { plugins: [], layout: { template: 'classic', regions: {} } },
      });
      const app = await loadApp({ default_signature: id });
      await app.bootstrap();
      await app.loadAppComposition('internal');

      expect(app.useThemeStore.getState().signature).toBe(id);
      expect(drawn()).toBe(id);
    },
  );

  it('the settings list offers the five looks by name', async () => {
    await loadApp({});
    const { resolveOptionSource } = await import('@/lib/option-sources');
    expect(resolveOptionSource('signatures')).toEqual([
      { value: 'digita', label: 'Digita' },
      { value: 'simetrix', label: 'simetrix' },
      { value: 'veloluck-workbench', label: 'Veloluck Workbench' },
      { value: 'veloluck-lakeside', label: 'Veloluck Lakeside' },
      { value: 'veloluck-precise', label: 'Veloluck Precise' },
    ]);
  });
});
