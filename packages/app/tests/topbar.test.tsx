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

describe('Topbar', () => {
  it('offers the mode control and no signature picker', () => {
    render(<Topbar />);

    expect(screen.getByRole('button', { name: 'ui.theme.toggle' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ui.signature.label' })).toBeNull();
  });
});
