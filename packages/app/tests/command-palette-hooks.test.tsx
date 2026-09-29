// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useUiStore } from '@/stores/ui';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { hasRole: () => boolean }) => unknown) => sel({ hasRole: () => false }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: { tEntity: (e: string, f?: string) => string }) => unknown) =>
    sel({ tEntity: (e, f) => f ?? e }),
}));
vi.mock('@/hooks/useNavigableCatalog', () => ({
  useNavigableCatalog: () => ({ navigable: [{ name: 'Order', label_plural: 'Orders' }], isLoading: false }),
}));

// The search result is swapped per test; the host derives the rows and the status from it.
let search: { data?: unknown[]; isFetching: boolean; isLoading: boolean; isError: boolean } = {
  data: [{ entity: 'Order', name: 'OR-1', title: 'Order 1' }, { title: 'no route' }],
  isFetching: false,
  isLoading: false,
  isError: false,
};
vi.mock('@/hooks/useGlobalSearch', () => ({ useGlobalSearch: () => search }));

import { CommandPalette } from '@/components/command/CommandPalette';

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

const hook = (name: string) => Array.from(document.body.querySelectorAll(`[data-ui="${name}"]`));

function openPalette(query: string) {
  useUiStore.setState({ commandPaletteOpen: true });
  render(
    <MemoryRouter>
      <CommandPalette />
      <Location />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } });
}

afterEach(cleanup);
beforeEach(() => {
  search = { ...search, isError: false, isFetching: false };
});

/** The palette the shell opens on Cmd+K is the kit composite, so one design rule set
 *  reaches it: nav items and record hits are its rows, the search state its status row. */
describe('CommandPalette host renders the kit palette', () => {
  it('maps nav items and record hits to grouped rows that carry the kit hooks', () => {
    openPalette('order');
    expect(hook('command-overlay')).toHaveLength(1);
    expect(hook('command-palette')[0]).toHaveAttribute('role', 'dialog');
    expect(hook('command-input')[0]).toHaveAttribute('role', 'combobox');
    expect(hook('command-group').map((g) => g.textContent)).toEqual(['ui.cmd.navGroup', 'ui.cmd.recordsGroup']);
    // Both nav rows of the Order entity, then the one hit that resolves to a route.
    expect(hook('command-item').map((r) => r.textContent)).toEqual([
      'Ordersui.cmd.openList',
      'ui.cmd.newRecordOrders',
      'Order 1Order',
    ]);
    expect(hook('command-item')[0]).toHaveAttribute('data-active');
    expect(hook('command-item')[0]).toHaveAttribute('aria-selected', 'true');
    expect(hook('command-status')).toHaveLength(0);
    expect(hook('command-footer')).toHaveLength(1);
    expect(hook('command-kbd')).toHaveLength(3);
  });

  it('shows the search error as the status row instead of the records group', () => {
    search = { ...search, isError: true };
    openPalette('order');
    expect(hook('command-status')[0]).toHaveTextContent('ui.cmd.searchError');
    expect(hook('command-group').map((g) => g.textContent)).toEqual(['ui.cmd.navGroup']);
    expect(hook('command-item')).toHaveLength(2);
  });

  it('shows a loading row while the search is in flight', () => {
    search = { ...search, isFetching: true };
    openPalette('order');
    expect(hook('command-status')[0]!.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('Enter opens the active row and closes; Escape closes', () => {
    openPalette('order');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByTestId('location')).toHaveTextContent('/Order/new');
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);

    act(() => useUiStore.setState({ commandPaletteOpen: true }));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });
});
