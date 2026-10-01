// @vitest-environment jsdom
// A language switch that fails is shown, not left as a page half in the old language.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/hooks/useAccount', () => ({ useProfileUpdate: () => ({ mutate: vi.fn() }) }));
vi.mock('@/components/overlay/DialogHost', () => ({ useDialogHost: () => ({ toast }) }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@digitaplatform/components', () => ({
  LanguageMenu: ({
    current,
    languages,
    onSelect,
  }: {
    current?: string;
    languages: { code: string }[];
    onSelect: (code: string) => void;
  }) => (
    <div>
      <span data-testid="current">{current}</span>
      {languages.map((l) => (
        <button key={l.code} onClick={() => onSelect(l.code)}>
          {l.code}
        </button>
      ))}
    </div>
  ),
}));

const { useSessionStore } = await import('@/stores/session');
const { useI18nStore } = await import('@/stores/i18n');
const { LanguageSwitcher } = await import('@/components/layout/LanguageSwitcher');

afterEach(() => {
  toast.mockReset();
  useI18nStore.setState({ locale: 'en' });
});

function offerLanguages(setLocale: (code: string) => Promise<void>) {
  useSessionStore.setState({
    allowUserLanguage: true,
    locale: { code: 'en' },
    languages: [
      { code: 'en', native_name: 'English' },
      { code: 'de', native_name: 'Deutsch' },
    ] as never,
    setLocale,
  });
}

describe('a language switch', () => {
  it('shows a switch that failed', async () => {
    offerLanguages(vi.fn(async () => {
      throw new Error('texts unreachable');
    }));
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByText('de'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('ui.status.somethingWrong', 'error'));
  });

  it('shows nothing when the switch succeeds', async () => {
    const setLocale = vi.fn(async () => undefined);
    offerLanguages(setLocale);
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByText('de'));
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('de'));
    expect(toast).not.toHaveBeenCalled();
  });

  // A failed switch leaves the old texts in use, while the boot after the profile save
  // already names the new language: the button shows the texts the page speaks.
  it('shows the language whose texts are in use, not the one whose load failed', () => {
    offerLanguages(vi.fn(async () => undefined));
    useSessionStore.setState({ locale: { code: 'de' } });
    useI18nStore.setState({ locale: 'en' });
    render(<LanguageSwitcher />);
    expect(screen.getByTestId('current')).toHaveTextContent('en');
  });

  it('shows the new language once its texts are in use', () => {
    offerLanguages(vi.fn(async () => undefined));
    useSessionStore.setState({ locale: { code: 'de' } });
    useI18nStore.setState({ locale: 'de' });
    render(<LanguageSwitcher />);
    expect(screen.getByTestId('current')).toHaveTextContent('de');
  });
});
