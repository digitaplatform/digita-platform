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
const WORKBENCH = '#B8541E';

// What the image stages from plugins.lock.json: two full looks of one company. A full signature
// carries a colour world and graphics, and only a full one stamps data-signature.
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
  plugins: [look('veloluck-workbench', WORKBENCH), look('veloluck-lakeside', '#1F7A5C')],
};

function bootData(branding: BootBranding): BootData {
  return {
    user: { _id: 'staff@veloluck.test', email: 'staff@veloluck.test', roles: ['System User'] },
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
      plugins: [{ id: 'veloluck-workbench' }, { id: 'veloluck-lakeside' }],
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
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('veloluck-workbench');
    expect(drawn()).toBe('veloluck-workbench');
    expect(document.documentElement.style.getPropertyValue('--color-primary-600')).toBe(
      app.theme.brandingStyle({ primary_color: WORKBENCH }).properties['--color-primary-600'],
    );
  });

  it('the default is never stored as the person\'s pick, so a changed default reaches them', async () => {
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBeNull();

    app.useThemeStore.getState().setBranding({ default_signature: 'veloluck-lakeside' });
    expect(app.useThemeStore.getState().signature).toBe('veloluck-lakeside');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBeNull();
    expect(services.setUserPreference).not.toHaveBeenCalled();
  });

  it('a pick the app does not offer falls to the tenant default, not to digita', async () => {
    localStorage.setItem(SIGNATURE_KEY, 'aurora');
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    expect(app.useThemeStore.getState().signature).toBe('digita');
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('veloluck-workbench');
    expect(drawn()).toBe('veloluck-workbench');
  });

  it('clicking the look already drawn stores no pick', async () => {
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setSignature('veloluck-workbench');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBeNull();
    expect(services.setUserPreference).not.toHaveBeenCalled();
  });

  it('clicking the look drawn over a pick the app does not offer stores the click, so that pick never returns', async () => {
    localStorage.setItem(SIGNATURE_KEY, 'aurora');
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setSignature('veloluck-workbench');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBe('veloluck-workbench');
    expect(services.setUserPreference).toHaveBeenCalledWith('ui.signature', 'veloluck-workbench');
  });

  it('a pick in the menu is stored and drawn, and wins over the tenant default', async () => {
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    app.useThemeStore.getState().setSignature('veloluck-lakeside');
    expect(app.useThemeStore.getState().signature).toBe('veloluck-lakeside');
    expect(localStorage.getItem(SIGNATURE_KEY)).toBe('veloluck-lakeside');
    expect(services.setUserPreference).toHaveBeenCalledWith('ui.signature', 'veloluck-lakeside');
  });

  it('a pick stored in this browser wins over the tenant default', async () => {
    localStorage.setItem(SIGNATURE_KEY, 'veloluck-lakeside');
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('veloluck-lakeside');
  });

  it('a pick roamed from ui.signature wins over the tenant default when it arrives before the composition', async () => {
    services.getUserPreference.mockImplementation(async (key: string) =>
      key === 'ui.signature' ? 'veloluck-lakeside' : undefined,
    );
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await vi.waitFor(() => expect(localStorage.getItem(SIGNATURE_KEY)).toBe('veloluck-lakeside'));
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('veloluck-lakeside');
    expect(drawn()).toBe('veloluck-lakeside');
  });

  it('a pick roamed from ui.signature wins over the tenant default when it arrives after the composition', async () => {
    let roam!: () => void;
    const roamed = new Promise<void>((resolve) => (roam = resolve));
    services.getUserPreference.mockImplementation(async (key: string) => {
      await roamed;
      return key === 'ui.signature' ? 'veloluck-lakeside' : undefined;
    });
    const app = await loadApp({ default_signature: 'veloluck-workbench' });
    await app.bootstrap();
    await app.loadAppComposition('internal');
    expect(app.useThemeStore.getState().signature).toBe('veloluck-workbench');

    roam();
    await vi.waitFor(() => expect(app.useThemeStore.getState().signature).toBe('veloluck-lakeside'));
    expect(drawn()).toBe('veloluck-lakeside');
  });

  it('without a tenant default, digita stays', async () => {
    const app = await loadApp({});
    await app.bootstrap();
    await app.loadAppComposition('internal');

    expect(app.useThemeStore.getState().signature).toBe('digita');
    expect(drawn()).toBe('digita');
  });
});
