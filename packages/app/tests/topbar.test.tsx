// @vitest-environment jsdom
// The top bar keeps the language, design, density and mode controls. The look is chosen for the
// whole tenant in its branding settings, so the bar offers no signature picker.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@/components/layout/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/layout/AppMenu', () => ({ AppMenu: () => null }));
vi.mock('@/components/layout/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
  useSaveLanguageToProfile: () => () => {},
}));

import { Topbar } from '@/components/layout/Topbar';
import { useThemeStore } from '@/stores/theme';

describe('Topbar', () => {
  it('offers the mode control and no signature picker', () => {
    render(<Topbar />);

    expect(screen.getByRole('button', { name: 'ui.theme.toggle' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ui.signature.label' })).toBeNull();
  });

  it('offers no light/dark choice while the tenant allows none', () => {
    useThemeStore.getState().setBranding({ allow_user_theme_mode: false });
    render(<Topbar />);

    expect(screen.queryByRole('button', { name: 'ui.theme.toggle' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ui.density.label' })).toBeTruthy();
  });

  it('offers no light/dark choice before /boot answers, while the cache says the tenant allows none', () => {
    useThemeStore.getState().setBranding({ allow_user_theme_mode: false });
    // A reload: the shell renders before /boot answers, and only the cache knows the lock.
    useThemeStore.setState({ branding: null });
    render(<Topbar />);

    expect(screen.queryByRole('button', { name: 'ui.theme.toggle' })).toBeNull();
  });
});
