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

  it('renders nothing while closed', () => {
    render(<CommandPalette open={false} items={items} onSelect={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
