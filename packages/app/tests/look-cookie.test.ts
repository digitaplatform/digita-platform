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

describe("the Domain of the app's look cookie", () => {
  it("is the tenant's zone of the sign-in address, for a choice and for the stored choices", async () => {
    const page = window as unknown as Record<string, unknown>;
    page.__AUTH_URL__ = 'https://auth.acme.example';
    const written: string[] = [];
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
    vi.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(function (this: Document, value: string) {
      written.push(value);
      cookie.set!.call(this, value);
    });
    try {
      vi.resetModules();
      const { useThemeStore: store } = await import('@/stores/theme');
      const lookWrites = () => written.filter((value) => value.startsWith(`${LOOK_COOKIE_NAME}=`));

      store.getState().setMode('dark');
      expect(lookWrites().at(-1)).toContain('; Domain=acme.example');

      written.length = 0;
      await store.getState().loadRemotePrefs();
      expect(lookWrites()).toHaveLength(1);
      expect(lookWrites()[0]).toContain('; Domain=acme.example');
    } finally {
      delete page.__AUTH_URL__;
      vi.restoreAllMocks();
    }
  });
});

