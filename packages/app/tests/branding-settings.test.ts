// @vitest-environment jsdom
// What an Administrator sets in Appearance & Branding reaches the screen once /boot hands the
// branding to the theme store: the tenant's favicon, and a lock on the light/dark choice. Each
// case loads the stores afresh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ getUserPreference: vi.fn(), setUserPreference: vi.fn() }));
vi.mock('@/services/userPreference', () => ({
  getUserPreference: services.getUserPreference,
  setUserPreference: services.setUserPreference,
}));

async function loadThemeStore() {
  vi.resetModules();
  return (await import('@/stores/theme')).useThemeStore;
}

const root = () => document.documentElement;
const iconHref = () => document.head.querySelector('link[rel="icon"]')?.getAttribute('href');

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute('data-density');
  root().classList.remove('dark');
  document.head.querySelectorAll('link[rel="icon"]').forEach((link) => link.remove());
  services.getUserPreference.mockResolvedValue(undefined);
  services.setUserPreference.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the branding a tenant sets', () => {
  it("shows the tenant's favicon, and the platform's when the tenant sets none", async () => {
    const store = await loadThemeStore();
    store.getState().setBranding({ favicon: '/files/favicon.png' });
    expect(iconHref()).toBe('/files/favicon.png');
    store.getState().setBranding({});
    expect(iconHref()).toContain('favicon.svg');
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it('follows the system mode while the tenant allows no light/dark choice, also over a roamed one', async () => {
    localStorage.setItem('digita-app:theme-mode', 'dark');
    const store = await loadThemeStore();
    expect(root().classList.contains('dark')).toBe(true);

    store.getState().setBranding({ allow_user_theme_mode: false });
    expect(store.getState().mode).toBe('system');
    expect(root().classList.contains('dark')).toBe(false);

    services.getUserPreference.mockImplementation(async (key: string) => (key === 'ui.theme_mode' ? 'dark' : undefined));
    await store.getState().loadRemotePrefs();
    expect(store.getState().mode).toBe('system');
    expect(root().classList.contains('dark')).toBe(false);
  });
});
