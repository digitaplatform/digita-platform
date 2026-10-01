// @vitest-environment jsdom
// A language switch without a reload formats and lays out the page as the engine resolves
// the new language: its direction from the Language row, and the format_locale of the
// user's own preference, else the language itself (the engine's LocaleResolver rule).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTranslations = vi.fn();
const getDoc = vi.fn();
const getUserPreference = vi.fn();
const getBoot = vi.fn();
vi.mock('@/services/translations', () => ({ getTranslations: (code: string) => getTranslations(code) }));
vi.mock('@/services/resource', () => ({ getDoc: (entity: string, name: string) => getDoc(entity, name) }));
vi.mock('@/services/userPreference', () => ({
  getUserPreference: (key: string) => getUserPreference(key),
  setUserPreference: vi.fn(),
}));
vi.mock('@/services/boot', () => ({ getBoot: () => getBoot() }));

const { useSessionStore } = await import('@/stores/session');

const LANGUAGES: Record<string, Record<string, unknown>> = {
  de: { _id: 'de', direction: 'ltr', date_format: 'DD.MM.YYYY', number_format: '#.###,##' },
  ar: { _id: 'ar', direction: 'rtl', date_format: 'DD/MM/YYYY', number_format: '#,###.##' },
  fr: { _id: 'fr', direction: 'ltr', date_format: 'DD/MM/YYYY', number_format: '# ###,##' },
};

beforeEach(() => {
  getTranslations.mockResolvedValue({ success: true, data: {} });
  getDoc.mockImplementation(async (entity: string, name: string) => {
    if (entity !== 'Language' || !LANGUAGES[name]) throw new Error(`unexpected read of ${entity}/${name}`);
    return { success: true, data: LANGUAGES[name] };
  });
  getUserPreference.mockResolvedValue(undefined);
  useSessionStore.setState({
    status: 'authenticated',
    locale: { code: 'en', direction: 'ltr', format_locale: 'en', timezone: 'Europe/Zurich' },
  });
  document.documentElement.dir = 'ltr';
});

afterEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ status: 'loading', locale: null });
});

describe('setLocale', () => {
  it('formats in the new language when the user set no format of their own', async () => {
    await useSessionStore.getState().setLocale('de');
    const locale = useSessionStore.getState().locale!;
    expect(locale.code).toBe('de');
    expect(locale.format_locale).toBe('de');
    expect(locale.direction).toBe('ltr');
    expect(locale.date_format).toBe('DD.MM.YYYY');
    expect(locale.timezone).toBe('Europe/Zurich');
  });

  it('keeps the format_locale the user set themselves', async () => {
    getUserPreference.mockResolvedValue(JSON.stringify({ format_locale: 'de-CH', timezone: null }));
    await useSessionStore.getState().setLocale('fr');
    expect(getUserPreference).toHaveBeenCalledWith('locale');
    expect(useSessionStore.getState().locale!.format_locale).toBe('de-CH');
  });

  it('turns the document right to left for a right-to-left language and back', async () => {
    await useSessionStore.getState().setLocale('ar');
    expect(useSessionStore.getState().locale!.direction).toBe('rtl');
    expect(document.documentElement.dir).toBe('rtl');
    await useSessionStore.getState().setLocale('de');
    expect(useSessionStore.getState().locale!.direction).toBe('ltr');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('takes the locale the engine resolves for a visitor who is not signed in', async () => {
    useSessionStore.setState({ status: 'anonymous' });
    getBoot.mockImplementation(async () => ({
      success: true,
      data: { locale: { code: document.documentElement.lang, direction: 'rtl', format_locale: 'ar', timezone: null } },
    }));
    await useSessionStore.getState().setLocale('ar');
    expect(useSessionStore.getState().locale).toMatchObject({ code: 'ar', direction: 'rtl', format_locale: 'ar' });
    expect(document.documentElement.dir).toBe('rtl');
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('fails the switch, keeping the current locale, when the language cannot be read', async () => {
    getDoc.mockRejectedValue(new Error('Language read failed'));
    await expect(useSessionStore.getState().setLocale('de')).rejects.toThrow('Language read failed');
    expect(useSessionStore.getState().locale!.code).toBe('en');
  });
});
