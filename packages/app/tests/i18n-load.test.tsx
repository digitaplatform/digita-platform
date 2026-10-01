// @vitest-environment jsdom
// A failed load of a language's texts is shown and can be tried again: it is never stored
// as a loaded empty map, which would show raw labels without a word.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getTranslations = vi.fn();
const getBoot = vi.fn();
const toast = vi.fn();
vi.mock('@/services/translations', () => ({ getTranslations: (code: string) => getTranslations(code) }));
vi.mock('@/services/boot', () => ({ getBoot: () => getBoot() }));
vi.mock('@/hooks/useAccount', () => ({ useProfileUpdate: () => ({ mutate: vi.fn() }) }));
vi.mock('@/components/overlay/DialogHost', () => ({ useDialogHost: () => ({ toast }) }));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@digitaplatform/components', () => ({
  LanguageMenu: ({ languages, onSelect }: { languages: { code: string }[]; onSelect: (code: string) => void }) => (
    <div>
      {languages.map((l) => (
        <button key={l.code} onClick={() => onSelect(l.code)}>
          {l.code}
        </button>
      ))}
    </div>
  ),
}));

const { useI18nStore, TranslationsLoadError } = await import('@/stores/i18n');
const { useSessionStore } = await import('@/stores/session');
const { LanguageSwitcher } = await import('@/components/layout/LanguageSwitcher');

beforeEach(() => {
  useI18nStore.setState({ locale: 'en', translations: { 'entity.Quote': 'Quote' }, loaded: true });
  document.documentElement.lang = 'en';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loading the texts of a language', () => {
  it('fails, naming the language, when the request fails, and keeps the texts it had', async () => {
    getTranslations.mockRejectedValue(new Error('engine restarting'));
    const load = useI18nStore.getState().load('de');
    await expect(load).rejects.toBeInstanceOf(TranslationsLoadError);
    await expect(load).rejects.toThrow('"de"');
    const state = useI18nStore.getState();
    expect(state.locale).toBe('en');
    expect(state.translations).toEqual({ 'entity.Quote': 'Quote' });
    expect(document.documentElement.lang).toBe('en');
  });

  it('fails when the engine answers without texts', async () => {
    getTranslations.mockResolvedValue({ success: false, data: null });
    await expect(useI18nStore.getState().load('de')).rejects.toThrow(TranslationsLoadError);
    expect(useI18nStore.getState().locale).toBe('en');
  });

  it('loads on a second try once the engine answers', async () => {
    getTranslations.mockRejectedValueOnce(new Error('engine restarting'));
    await expect(useI18nStore.getState().load('de')).rejects.toThrow();
    getTranslations.mockResolvedValue({ success: true, data: { 'entity.Quote': 'Offerte' } });
    await useI18nStore.getState().load('de');
    const state = useI18nStore.getState();
    expect(state).toMatchObject({ locale: 'de', loaded: true, translations: { 'entity.Quote': 'Offerte' } });
    expect(document.documentElement.lang).toBe('de');
  });
});

describe('a language switch whose texts fail to load', () => {
  beforeEach(() => {
    useSessionStore.setState({
      status: 'authenticated',
      allowUserLanguage: true,
      locale: { code: 'en', format_locale: 'en', direction: 'ltr' },
      languages: [
        { code: 'en', native_name: 'English' },
        { code: 'de', native_name: 'Deutsch' },
      ] as never,
    });
  });

  it('tells the person which language failed', async () => {
    getTranslations.mockRejectedValue(new Error('engine restarting'));
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByText('de'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('ui.lang.textsNotLoaded {"language":"Deutsch"}', 'error'));
    expect(useSessionStore.getState().locale!.code).toBe('en');
  });

  it('switches a visitor who is not signed in without the texts that need a sign-in', async () => {
    useSessionStore.setState({ status: 'anonymous', locale: { code: 'en' } });
    getBoot.mockResolvedValue({ success: true, data: { locale: { code: 'de', direction: 'ltr', format_locale: 'de' } } });
    await useSessionStore.getState().setLocale('de');
    expect(getTranslations).not.toHaveBeenCalled();
    expect(useI18nStore.getState().locale).toBe('de');
    expect(document.documentElement.lang).toBe('de');
    expect(useSessionStore.getState().locale).toMatchObject({ code: 'de', format_locale: 'de' });
  });
});
