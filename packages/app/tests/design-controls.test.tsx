// @vitest-environment jsdom
// The design showcase previews a signature only while it is open: leaving it draws the tenant's
// look again, so a preview never follows the reviewer through the app.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { DesignControls } from '@/components/design-showcase/DesignControls';
import { GalleryComposites } from '@/components/design-showcase/GalleryComposites';
import { useThemeStore } from '@/stores/theme';

const drawn = () => document.documentElement.getAttribute('data-signature');

describe('DesignControls', () => {
  it("draws the tenant's look again when the showcase closes", () => {
    useThemeStore.getState().setBranding({ default_signature: 'veloluck-workbench' });
    const view = render(<DesignControls />);
    useThemeStore.getState().previewSignature('veloluck-lakeside');
    expect(drawn()).toBe('veloluck-lakeside');

    view.unmount();
    expect(useThemeStore.getState().signature).toBe('veloluck-workbench');
    expect(drawn()).toBe('veloluck-workbench');
  });
});

describe('the showcase under the light/dark lock', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ branding: null });
  });

  it('offers the mode control and the ModeButton where the tenant allows the choice', () => {
    useThemeStore.getState().setBranding({ allow_user_theme_mode: true });
    render(<DesignControls />);
    render(<GalleryComposites />);
    expect(screen.queryByLabelText('ui.theme.toggle')).not.toBeNull();
    expect(screen.queryByText('ModeButton')).not.toBeNull();
  });

  it('offers neither where the tenant allows no light/dark choice', () => {
    useThemeStore.getState().setBranding({ allow_user_theme_mode: false });
    render(<DesignControls />);
    render(<GalleryComposites />);
    expect(screen.queryByLabelText('ui.theme.toggle')).toBeNull();
    expect(screen.queryByText('ModeButton')).toBeNull();
  });
});
