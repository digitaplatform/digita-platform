// @vitest-environment jsdom
// The shell's scroll container pads its top for everything that pins at the top: the top bar,
// the page header's bar and a record form's tab strip, each by the height it publishes.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  Outlet: () => <div>page</div>,
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('@/templates/template-registry', () => ({
  resolveTemplate: () => ({ id: 'classic', version: 1, regions: [{ id: 'main', side: 'main' }] }),
}));
vi.mock('@/components/layout/Topbar', () => ({ Topbar: () => <div>topbar</div> }));
vi.mock('@/components/command/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeConnection: () => {} }));
vi.mock('@/plugins/registry', () => ({ Region: () => null }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import { ShellRenderer } from '@/templates/ShellRenderer';

describe('ShellRenderer scroll padding', () => {
  it('pads the scroll for the top bar, the header bar and the pinned tab strip', () => {
    render(<ShellRenderer />);
    expect(screen.getByRole('main').className).toContain(
      '[scroll-padding-top:calc(var(--topbar-h,0px)_+_var(--page-header-bar-h,0px)_+_var(--form-tabs-h,0px))]',
    );
  });
});
