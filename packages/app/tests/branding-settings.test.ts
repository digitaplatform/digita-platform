// @vitest-environment jsdom
// What an Administrator sets in Appearance & Branding reaches the screen once /boot hands the
// branding to the theme store: the tenant's density for everyone who chose none, the tenant's
// favicon, and a lock on the light/dark choice. Each case loads the stores afresh.
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
  it("gives everyone who chose no density the tenant's density, and keeps a person's own", async () => {
    let store = await loadThemeStore();
    store.getState().setBranding({ density: 'compact' });
    expect(store.getState().density).toBe('compact');
    expect(root().getAttribute('data-density')).toBe('compact');

    localStorage.setItem('digita-app:density', 'spacious');
    store = await loadThemeStore();
    store.getState().setBranding({ density: 'compact' });
    expect(store.getState().density).toBe('spacious');
    expect(root().getAttribute('data-density')).toBe('spacious');
  });

  it("shows the tenant's favicon, and the platform's when the tenant sets none", async () => {
    const store = await loadThemeStore();
    store.getState().setBranding({ favicon: '/files/favicon.png' });
    expect(iconHref()).toBe('/files/favicon.png');
    store.getState().setBranding({});
    expect(iconHref()).toContain('favicon.svg');
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it("shows the icon of the signature the tenant wears where it sets no favicon, and the favicon over it", async () => {
    const store = await loadThemeStore();
    const { registerSignature } = await import('@digitaplatform/theme');
    const icon = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    registerSignature({ id: 'tab-icon-test', name: 'Tab icon test', accent: '#112233', icon });
    store.getState().setBranding({ default_signature: 'tab-icon-test' });
    expect(iconHref()).toBe(`data:image/svg+xml,${encodeURIComponent(icon)}`);
    store.getState().setBranding({ default_signature: 'tab-icon-test', favicon: '/files/favicon.png' });
    expect(iconHref()).toBe('/files/favicon.png');
  });

  it("PLANTED DEFECT: shows the platform's favicon, not one the branding names on another host", async () => {
    const store = await loadThemeStore();
    store.getState().setBranding({ favicon: 'https://evil.example/favicon.png' });
    expect(iconHref()).toContain('favicon.svg');
    store.getState().setBranding({ favicon: '//evil.example/favicon.png' });
    expect(iconHref()).toContain('favicon.svg');
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

  it("paints a locked tenant's first frame in the system mode, though a dark mode is stored", async () => {
    let store = await loadThemeStore();
    store.getState().setBranding({ allow_user_theme_mode: false });
    localStorage.setItem('digita-app:theme-mode', 'dark');

    store = await loadThemeStore();
    expect(store.getState().mode).toBe('system');
    expect(root().classList.contains('dark')).toBe(false);
  });

  it('stores no roamed mode while the tenant allows no light/dark choice', async () => {
    const store = await loadThemeStore();
    store.getState().setBranding({ allow_user_theme_mode: false });
    services.getUserPreference.mockImplementation(async (key: string) => (key === 'ui.theme_mode' ? 'dark' : undefined));
    await store.getState().loadRemotePrefs();
    expect(localStorage.getItem('digita-app:theme-mode')).toBeNull();
  });

  it("gives a person's own mode back at once when the tenant lifts the lock", async () => {
    localStorage.setItem('digita-app:theme-mode', 'dark');
    const store = await loadThemeStore();
    store.getState().setBranding({ allow_user_theme_mode: false });
    expect(store.getState().mode).toBe('system');

    store.getState().setBranding({ allow_user_theme_mode: true });
    expect(store.getState().mode).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
  });

  it("paints a person's own mode on the first frame again once the tenant lifted the lock", async () => {
    localStorage.setItem('digita-app:theme-mode', 'dark');
    let store = await loadThemeStore();
    store.getState().setBranding({ allow_user_theme_mode: false });
    store.getState().setBranding({ allow_user_theme_mode: true });
    root().classList.remove('dark');

    store = await loadThemeStore();
    expect(store.getState().mode).toBe('dark');
    expect(root().classList.contains('dark')).toBe(true);
  });

  it('changes no mode under the lock, not even from the design showcase', async () => {
    const store = await loadThemeStore();
    store.getState().setBranding({ allow_user_theme_mode: false });
    store.getState().setMode('dark');
    expect(store.getState().mode).toBe('system');
    expect(localStorage.getItem('digita-app:theme-mode')).toBeNull();
    expect(services.setUserPreference).not.toHaveBeenCalled();
  });
});
