// @vitest-environment jsdom
// A language switch without a reload formats and lays out the page as the engine resolves
// the new language: its direction as /boot offers it, and the person's own region, else the
// language itself (the engine's LocaleResolver rule). It reads nothing a role has to grant,
// because a person whose roles grant no read of Language rows or preferences switches too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/errors';

const refused = async () => {
  throw new ApiClientError('Forbidden', 403);
};
const getTranslations = vi.fn();
const getDoc = vi.fn(refused);
const getUserPreference = vi.fn(refused);
const getBoot = vi.fn(refused);
vi.mock('@/services/translations', () => ({ getTranslations: (code: string) => getTranslations(code) }));
vi.mock('@/services/resource', () => ({ getDoc: () => getDoc() }));
vi.mock('@/services/userPreference', () => ({
  getUserPreference: () => getUserPreference(),
  setUserPreference: vi.fn(),
}));
vi.mock('@/services/boot', () => ({ getBoot: () => getBoot() }));

const { useSessionStore } = await import('@/stores/session');
const { useI18nStore } = await import('@/stores/i18n');

beforeEach(() => {
  getTranslations.mockResolvedValue({ success: true, data: {} });
  useSessionStore.setState({
    status: 'authenticated',
    locale: { code: 'en', direction: 'ltr', format_locale: 'en', timezone: 'Europe/Zurich' },
    languages: [
      { code: 'en', native_name: 'English', direction: 'ltr' },
      { code: 'de', native_name: 'Deutsch', direction: 'ltr' },
      { code: 'ar', native_name: 'العربية', direction: 'rtl' },
      { code: 'fr', native_name: 'Français', direction: 'ltr' },
    ],
  });
  document.documentElement.dir = 'ltr';
});

afterEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ status: 'loading', locale: null, languages: [] });
});

describe('setLocale', () => {
  it('switches for a person whose roles grant no read of Language rows or preferences', async () => {
    await useSessionStore.getState().setLocale('de');
    expect(useSessionStore.getState().locale!.code).toBe('de');
    expect(useI18nStore.getState().locale).toBe('de');
    expect(getDoc).not.toHaveBeenCalled();
    expect(getUserPreference).not.toHaveBeenCalled();
  });

  it('formats in the new language when the person set no region of their own', async () => {
    await useSessionStore.getState().setLocale('de');
    expect(useSessionStore.getState().locale).toEqual({
      code: 'de',
      direction: 'ltr',
      format_locale: 'de',
      timezone: 'Europe/Zurich',
    });
  });

  it('keeps the region the person set themselves', async () => {
    useSessionStore.setState({ locale: { code: 'en', direction: 'ltr', format_locale: 'de-CH', timezone: null } });
    await useSessionStore.getState().setLocale('fr');
    expect(useSessionStore.getState().locale).toMatchObject({ code: 'fr', format_locale: 'de-CH' });
  });

  it('turns the document right to left for a right-to-left language and back', async () => {
    await useSessionStore.getState().setLocale('ar');
    expect(useSessionStore.getState().locale!.direction).toBe('rtl');
    expect(document.documentElement.dir).toBe('rtl');
    await useSessionStore.getState().setLocale('de');
    expect(useSessionStore.getState().locale!.direction).toBe('ltr');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches a visitor who is not signed in by the same rule', async () => {
    useSessionStore.setState({ status: 'anonymous', locale: { code: 'en', direction: 'ltr', format_locale: 'en', timezone: null } });
    await useSessionStore.getState().setLocale('ar');
    expect(useSessionStore.getState().locale).toEqual({ code: 'ar', direction: 'rtl', format_locale: 'ar', timezone: null });
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(getTranslations).not.toHaveBeenCalled();
  });

  it('fails the switch, keeping the current locale, when the texts cannot be loaded', async () => {
    getTranslations.mockRejectedValue(new Error('texts unreachable'));
    await expect(useSessionStore.getState().setLocale('de')).rejects.toThrow();
    expect(useSessionStore.getState().locale!.code).toBe('en');
  });
});
