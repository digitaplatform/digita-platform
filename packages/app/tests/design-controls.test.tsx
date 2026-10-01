// @vitest-environment jsdom
// The design showcase previews a signature only while it is open: leaving it draws the tenant's
// look again, so a preview never follows the reviewer through the app.
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { DesignControls } from '@/components/design-showcase/DesignControls';
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
