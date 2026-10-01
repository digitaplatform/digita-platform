// @vitest-environment jsdom
// The signature a person starts on, through the boot App() runs: /boot answers with the tenant's
// branding, the person's own choices roam in from UserPreference without being awaited, and the
// plugin composition registers the signatures this app delivers. Each case loads the stores and
// the theme's signature registry afresh, so no case sees a signature another case registered.
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

const SIGNATURE_KEY = 'digita-app:signature';
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
    system_settings: { platform_name: 'Digita Platform', default_currency: null, allow_user_language: true, is_first_run: false },
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

describe('the signature a person starts on', () => {
  it("a person without a pick starts on the tenant's default signature once the composition registers it", async () => {
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('harbor-yard');
    expect(drawn()).toBe('harbor-yard');
    expect(document.documentElement.style.getPropertyValue('--color-primary-600')).toBe(
      app.theme.brandingStyle({ primary_color: YARD }).properties['--color-primary-600'],
    );
  });

  it('the default is never stored as the person\'s pick, so a changed default reaches them', async () => {
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBeNull();

    app.useThemeStore.getState().setBranding({ default_signature: 'harbor-dock' });
    expect(app.useThemeStore.getState().signature).toBe('harbor-dock');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBeNull();
    expect(services.setUserPreference).not.toHaveBeenCalled();
  });

  it('a pick the app does not offer draws digita until /boot answers, then the tenant default', async () => {
    localStorage.setItem(SIGNATURE_KEY, 'aurora');
    const app = await loadApp({ default_signature: 'harbor-yard' });
    expect(app.useThemeStore.getState().signature).toBe('digita');
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('harbor-yard');
    expect(drawn()).toBe('harbor-yard');
  });

  it('clicking the look already drawn stores no pick', async () => {
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setSignature('harbor-yard');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBeNull();
    expect(services.setUserPreference).not.toHaveBeenCalled();
  });

  it('clicking the look drawn over a pick the app does not offer stores the click, so that pick never returns', async () => {
    localStorage.setItem(SIGNATURE_KEY, 'aurora');
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setSignature('harbor-yard');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBe('harbor-yard');
    expect(services.setUserPreference).toHaveBeenCalledWith('ui.signature', 'harbor-yard');
  });

  it('a pick in the menu is stored and drawn, and wins over the tenant default', async () => {
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setSignature('harbor-dock');
    expect(app.useThemeStore.getState().signature).toBe('harbor-dock');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBe('harbor-dock');
    expect(services.setUserPreference).toHaveBeenCalledWith('ui.signature', 'harbor-dock');
  });

  it('a pick stored in this browser wins over the tenant default', async () => {
    localStorage.setItem(SIGNATURE_KEY, 'harbor-dock');
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('harbor-dock');
  });

  it('a pick roamed from ui.signature wins over the tenant default when it arrives before the composition', async () => {
    services.getUserPreference.mockImplementation(async (key: string) =>
      key === 'ui.signature' ? 'harbor-dock' : undefined,
    );
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await vi.waitFor(() => expect(localStorage.getItem(SIGNATURE_KEY)).toBe('harbor-dock'));
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('harbor-dock');
    expect(drawn()).toBe('harbor-dock');
  });

  it('a pick roamed from ui.signature wins over the tenant default when it arrives after the composition', async () => {
    let roam!: () => void;
    const roamed = new Promise<void>((resolve) => (roam = resolve));
    services.getUserPreference.mockImplementation(async (key: string) => {
      await roamed;
      return key === 'ui.signature' ? 'harbor-dock' : undefined;
    });
    const app = await loadApp({ default_signature: 'harbor-yard' });
    await app.bootstrap();
    await app.loadAppComposition('internal');
    expect(app.useThemeStore.getState().signature).toBe('harbor-yard');

    roam();
    await vi.waitFor(() => expect(app.useThemeStore.getState().signature).toBe('harbor-dock'));
    expect(drawn()).toBe('harbor-dock');
  });

  it('without a tenant default, digita stays', async () => {
    const app = await loadApp({});
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('digita');
    expect(drawn()).toBe('digita');
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
