// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { CommandPaletteView } from '@/components/command/CommandPaletteView';

/** The palette the shell opens on Cmd+K carries the kit palette's hooks, so one design
 *  rule set reaches both, and its veil is the theme's scrim. */
describe('CommandPaletteView emits the kit palette hooks', () => {
  it('marks the overlay, the panel, the input, the group labels and the rows', () => {
    render(
      <CommandPaletteView
        open
        query="or"
        onQuery={() => {}}
        items={[{ id: 'orders', kind: 'nav-list', label: 'Orders', to: '/Order' }]}
        searchResults={[{ entity: 'Order', name: 'OR-1', title: 'Order 1' }]}
        loading={false}
        error={false}
        activeIndex={0}
        onActiveIndex={() => {}}
        onSelect={() => {}}
        onClose={() => {}}
        navCatalogEmpty={false}
      />,
    );
    const hook = (name: string) => document.body.querySelectorAll(`[data-ui="${name}"]`);
    expect(hook('command-overlay')).toHaveLength(1);
    expect(hook('command-overlay')[0]!.className).toContain('bg-scrim');
    expect(hook('command-overlay')[0]!.className).not.toContain('bg-black');
    expect(hook('command-palette')[0]).toHaveAttribute('role', 'dialog');
    expect(hook('command-input')[0]).toHaveAttribute('role', 'combobox');
    expect(hook('command-group')).toHaveLength(2);
    expect(hook('command-item')).toHaveLength(2);
    expect(hook('command-item')[0]).toHaveAttribute('aria-selected', 'true');
  });
});
