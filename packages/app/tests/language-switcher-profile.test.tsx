// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// The IdP writes a user's mails in their profile's language, so the language a signed-in user
// picks in the top bar must reach the profile (#18). The sign-in shell only switches the page.
const mutate = vi.fn();
const toast = vi.fn();
vi.mock('@/hooks/useAccount', () => ({ useProfileUpdate: () => ({ mutate }) }));
vi.mock('@/components/overlay/DialogHost', () => ({ useDialogHost: () => ({ toast }) }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
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

const { useSessionStore } = await import('@/stores/session');
const { LanguageSwitcher, useSaveLanguageToProfile } = await import('@/components/layout/LanguageSwitcher');

function offerLanguages() {
  const setLocale = vi.fn(async () => undefined);
  useSessionStore.setState({
    allowUserLanguage: true,
    locale: { code: 'en' },
    languages: [
      { code: 'en', native_name: 'English' },
      { code: 'de', native_name: 'Deutsch' },
    ] as never,
    setLocale,
  });
  return setLocale;
}

function SaveButton() {
  const save = useSaveLanguageToProfile();
  return <button onClick={() => save('de')}>save</button>;
}

describe('the language switcher', () => {
  beforeEach(() => {
    mutate.mockReset();
    toast.mockReset();
  });
  afterEach(cleanup);

  it('switches the page and hands the choice to the top bar', () => {
    const setLocale = offerLanguages();
    const chosen = vi.fn();
    render(<LanguageSwitcher onChosen={chosen} />);
    fireEvent.click(screen.getByText('de'));
    expect(setLocale).toHaveBeenCalledWith('de');
    expect(chosen).toHaveBeenCalledWith('de');
  });

  it('only switches the page in the sign-in shell, which passes no onChosen', () => {
    const setLocale = offerLanguages();
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByText('de'));
    expect(setLocale).toHaveBeenCalledWith('de');
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('saving the top bar choice to the profile', () => {
  beforeEach(() => {
    mutate.mockReset();
    toast.mockReset();
  });
  afterEach(cleanup);

  it('writes the language to the IdP profile', () => {
    render(<SaveButton />);
    fireEvent.click(screen.getByText('save'));
    expect(mutate).toHaveBeenCalledWith({ language: 'de' }, expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('says so when the profile could not be saved', () => {
    render(<SaveButton />);
    fireEvent.click(screen.getByText('save'));
    (mutate.mock.calls[0]?.[1] as { onError: () => void }).onError();
    expect(toast).toHaveBeenCalledWith('ui.lang.notSaved', 'error');
  });
});
