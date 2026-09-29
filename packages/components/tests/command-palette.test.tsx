import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette, type CommandPaletteItem } from '../src/composites/CommandPalette.js';

const items: CommandPaletteItem[] = [
  { id: 'home', label: 'Home', group: 'Navigate' },
  { id: 'orders', label: 'Orders', group: 'Navigate', shortcut: 'Ctrl+O' },
  { id: 'reset', label: 'Reset demo', sublabel: 'Destructive', group: 'Actions', keywords: 'wipe' },
  { id: 'locked', label: 'Locked', group: 'Actions', disabled: true },
];

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette open items={items} onSelect={onSelect} onClose={onClose} {...overrides} />,
  );
  return { onSelect, onClose, input: screen.getByRole('combobox') as HTMLInputElement, ...utils };
}

describe('CommandPalette', () => {
  it('renders a labeled dialog with the input focused, groups and shortcuts', () => {
    renderPalette();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    expect(screen.getByText('Navigate')).toBeTruthy(); // group headings
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Navigate')).toHaveAttribute('data-ui', 'command-group');
    expect(screen.getByRole('combobox')).toHaveAttribute('data-ui', 'command-input');
    expect(screen.getByText('Ctrl+O')).toBeTruthy(); // kbd shortcut hint
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('type-to-filter narrows by label AND keywords; empty state when nothing matches', () => {
    const { input } = renderPalette();
    fireEvent.change(input, { target: { value: 'wipe' } }); // keywords-only match
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Reset demo');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('ArrowDown/ArrowUp move the highlight and Enter selects the active item', () => {
    const { input, onSelect } = renderPalette();
    // Initial highlight = first enabled item.
    expect(input).toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'orders' }));
  });

  it('skips disabled items when navigating and never selects them', () => {
    const { input, onSelect } = renderPalette();
    // Down twice from Home → Orders → Reset demo; third wraps PAST the disabled row.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'home' }));

    onSelect.mockClear();
    fireEvent.change(input, { target: { value: 'Locked' } }); // only the disabled row remains
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Locked/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects on mousedown (mouse path) with the full item as payload', () => {
    const { onSelect } = renderPalette();
    fireEvent.mouseDown(screen.getByRole('option', { name: /Reset demo/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'reset', keywords: 'wipe' }));
  });

  it('Escape and backdrop mousedown call onClose', () => {
    const { input, onClose } = renderPalette();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector('[data-ui="command-overlay"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('emits every palette hook, and a row that lost its hook is caught', () => {
    renderPalette({ status: 'Searching…', statusGroup: 'Records', listLabel: 'Results' });
    const hook = (name: string) => Array.from(document.body.querySelectorAll(`[data-ui="${name}"]`));
    expect(hook('command-overlay')).toHaveLength(1);
    expect(hook('command-overlay')[0]!.className).toContain('bg-scrim');
    expect(hook('command-palette')[0]).toHaveAttribute('role', 'dialog');
    expect(hook('command-input')[0]).toHaveAttribute('role', 'combobox');
    expect(screen.getByRole('listbox', { name: 'Results' })).toBeTruthy();
    // The status row sits under its own heading, so a reader knows which group it is about.
    expect(hook('command-group').map((g) => g.textContent)).toEqual(['Navigate', 'Actions', 'Records']);
    expect(hook('command-kbd').map((k) => k.textContent)).toEqual(['Ctrl+O', '↑↓', '↵', 'esc']);
    expect(hook('command-status')[0]).toHaveTextContent('Searching…');
    expect(hook('command-footer')[0]).toHaveTextContent('↑↓navigate↵selectescclose');
    expect(hook('command-item')[0]).toHaveAttribute('data-active');
    expect(hook('command-item')[1]).not.toHaveAttribute('data-active');

    // Every option row is a hooked command-item; the planted defect is one row stripped of
    // its hook, which this check must report.
    const unhooked = () => screen.getAllByRole('option').filter((row) => row.getAttribute('data-ui') !== 'command-item');
    expect(unhooked()).toEqual([]);
    screen.getAllByRole('option')[2]!.removeAttribute('data-ui');
    expect(unhooked().map((row) => row.textContent)).toEqual(['Reset demoDestructive']);
  });

  it('a controlled query is not re-filtered and a controlled active index is reported', () => {
    const onQueryChange = vi.fn();
    const onActiveIndexChange = vi.fn();
    const { input } = renderPalette({ query: 'zzz', onQueryChange, activeIndex: 1, onActiveIndexChange });
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(input, { target: { value: 'wipe' } });
    expect(onQueryChange).toHaveBeenCalledWith('wipe');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onActiveIndexChange).toHaveBeenLastCalledWith(2);
  });

  it('keeps the highlighted row when the list changes under the same query, and starts at the top on a new query', () => {
    const controlled = (rows: CommandPaletteItem[], query: string) => (
      <CommandPalette open items={rows} onSelect={() => {}} onClose={() => {}} query={query} onQueryChange={() => {}} />
    );
    const { rerender } = render(controlled(items, 'or'));
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /Orders/ })).toHaveAttribute('aria-selected', 'true');
    // An async host hands over a new array when its hits arrive: the highlight stays on Orders.
    const hit: CommandPaletteItem = { id: 'hit', label: 'Order 1', group: 'Records' };
    rerender(controlled([hit, ...items], 'or'));
    expect(screen.getByRole('option', { name: /Orders/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Order 1/ })).toHaveAttribute('aria-selected', 'false');
    // A new query starts at the first row again.
    fireEvent.change(input, { target: { value: 'ord' } });
    rerender(controlled([hit, ...items], 'ord'));
    expect(screen.getByRole('option', { name: /Order 1/ })).toHaveAttribute('aria-selected', 'true');
    // The highlighted row leaving the list reseats the highlight on the first enabled row.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    rerender(controlled(items, 'ord'));
    expect(screen.getByRole('option', { name: /^Home$/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a reopen starts at the top row, not on the row of the last query', () => {
    const palette = (open: boolean) => <CommandPalette open={open} items={items} onSelect={() => {}} onClose={() => {}} />;
    const { rerender } = render(palette(true));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'reset' } });
    expect(screen.getByRole('option', { name: /Reset demo/ })).toHaveAttribute('aria-selected', 'true');
    rerender(palette(false));
    rerender(palette(true));
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('Home and End jump to the first and the last enabled row', () => {
    const { input, onSelect } = renderPalette();
    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'reset' }));
    fireEvent.keyDown(input, { key: 'Home' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'home' }));
  });

  it('renders nothing while closed', () => {
    render(<CommandPalette open={false} items={items} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
