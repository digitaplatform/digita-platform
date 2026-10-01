// @vitest-environment jsdom
// The top bar keeps the language, design, density and mode controls. The look is chosen for the
// whole tenant in its branding settings, so the bar offers no signature picker.
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  // Each case starts with no branding and no cached lock, so none inherits the lock of another.
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ branding: null });
  });

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

  it("follows the store's lock rule, which reads the cache while no branding is loaded", () => {
    useThemeStore.getState().setBranding({ allow_user_theme_mode: false });
    // The app mounts the top bar only after /boot, so this state is built by hand: no branding,
    // only the cached lock, which setMode judges by as well.
    useThemeStore.setState({ branding: null });
    render(<Topbar />);

    expect(screen.queryByRole('button', { name: 'ui.theme.toggle' })).toBeNull();
  });
});
