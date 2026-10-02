// @vitest-environment jsdom
// The app writes a person's choices into the look cookie too, so the tenant's sign-in pages, report
// designer and website on other hosts wear them: when the person picks a choice, and when their
// stored choices arrive after sign-in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOOK_COOKIE_NAME, readLookCookie } from '@digitaplatform/theme';

const getUserPreference = vi.fn(async (key: string) => ({ 'ui.design': 'ios', 'ui.theme_mode': 'dark', 'ui.density': 'spacious' })[key] ?? null);
vi.mock('@/services/userPreference', () => ({
  getUserPreference: (key: string) => getUserPreference(key),
  setUserPreference: async () => {},
}));

const { useThemeStore } = await import('@/stores/theme');

afterEach(() => {
  document.cookie = `${LOOK_COOKIE_NAME}=; Path=/; Max-Age=0`;
  localStorage.clear();
});

describe("the app's look cookie", () => {
  it("is written with each of the person's choices", () => {
    useThemeStore.getState().setDesign('fluent');
    useThemeStore.getState().setMode('dark');
    useThemeStore.getState().setDensity('compact');
    expect(readLookCookie()).toEqual({ design: 'fluent', mode: 'dark', density: 'compact' });
  });

  it("is written with the person's stored choices after sign-in", async () => {
    await useThemeStore.getState().loadRemotePrefs();
    expect(readLookCookie()).toEqual({ design: 'ios', mode: 'dark', density: 'spacious' });
  });
});
