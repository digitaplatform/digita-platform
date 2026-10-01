// @vitest-environment jsdom
// Every demo visitor signs in as the same demo user, so the theme mode, density and design one
// visitor picks must never reach the UserPreference rows the next visitor would read.
import { afterEach, describe, expect, it, vi } from 'vitest';

const getUserPreference = vi.fn(async () => null);
const setUserPreference = vi.fn(async () => {});
const getBoot = vi.fn();
vi.mock('@/services/userPreference', () => ({
  getUserPreference: (...a: unknown[]) => getUserPreference(...(a as [])),
  setUserPreference: (...a: unknown[]) => setUserPreference(...(a as [])),
}));
vi.mock('@/services/boot', () => ({ getBoot: () => getBoot() }));
vi.mock('@/services/api', () => ({ attemptRefresh: async () => false }));

const { useSessionStore } = await import('@/stores/session');
const { useThemeStore } = await import('@/stores/theme');

const bootAs = (demo: boolean) =>
  getBoot.mockResolvedValue({
    success: true,
    data: {
      user: { _id: 'demo@show.test', email: 'demo@show.test', roles: ['System User'], ...(demo ? { demo } : {}) },
      locale: { code: 'en', direction: 'ltr', format_locale: 'en', timezone: null },
      available_languages: [],
      system_settings: null,
    },
  });

afterEach(() => {
  vi.clearAllMocks();
  useThemeStore.setState({ roams: true });
});

describe('a demo visitor\'s theme picks (#404)', () => {
  it('neither reads nor writes the shared demo user\'s preferences', async () => {
    bootAs(true);
    await useSessionStore.getState().bootstrap();
    useThemeStore.getState().setMode('dark');
    useThemeStore.getState().setDensity('compact');
    useThemeStore.getState().setDesign('minimal');

    expect(getUserPreference).not.toHaveBeenCalled();
    expect(setUserPreference).not.toHaveBeenCalled();
    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('roam for anybody else, as before', async () => {
    bootAs(false);
    await useSessionStore.getState().bootstrap();
    useThemeStore.getState().setMode('dark');
    useThemeStore.getState().setDensity('compact');
    useThemeStore.getState().setDesign('minimal');

    expect(getUserPreference).toHaveBeenCalled();
    expect(setUserPreference.mock.calls).toEqual([
      ['ui.theme_mode', 'dark'],
      ['ui.density', 'compact'],
      ['ui.design', 'minimal'],
    ]);
  });
});
