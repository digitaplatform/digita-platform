import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Combobox, type ComboboxOption } from '../src/composites/Combobox.js';

const OPTIONS: ComboboxOption[] = [
  { id: 'C1', label: 'Acme GmbH', subtitle: 'Berlin' },
  { id: 'C2', label: 'Acme Ltd' },
  { id: 'C3', label: 'Acme Inc' },
];

function Host({
  onPick = () => {},
  onSubmit = () => {},
  options = OPTIONS,
  loading = false,
}: {
  onPick?: (o: ComboboxOption) => void;
  onSubmit?: () => void;
  options?: ComboboxOption[];
  loading?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Combobox
        value="Stored Display"
        query={query}
        onQueryChange={setQuery}
        options={options}
        loading={loading}
        open={open}
        onOpenChange={setOpen}
        onPick={onPick}
        placeholder="Search customer"
      />
      <button type="submit">Save</button>
    </form>
  );
}

describe('Combobox keyboard machine', () => {
  it('opens on focus and lists the options in a portaled listbox', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('ArrowDown twice + Enter picks the second option and prevents default', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onSubmit = vi.fn();
    render(<Host onPick={onPick} onSubmit={onSubmit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(OPTIONS[1]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter with empty/loading options never submits the surrounding form', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onSubmit = vi.fn();
    render(<Host onPick={onPick} onSubmit={onSubmit} options={[]} loading />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Tab with an open popup picks the highlighted option and moves focus on', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Host onPick={onPick} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    await user.tab();
    expect(onPick).toHaveBeenCalledWith(OPTIONS[0]);
    expect(input).not.toHaveFocus();
  });

  it('Escape closes only the popup, keeps focus, and marks the event consumed', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(input, evt);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(evt.defaultPrevented).toBe(true);
  });

  it('keeps the highlight when the options array identity changes for the same query', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { rerender } = render(<Host onPick={onPick} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // Fresh array identity, same content (a background re-render).
    rerender(<Host onPick={onPick} options={OPTIONS.map((o) => ({ ...o }))} />);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'C2' }));
  });

  it('ignores a stray hover (no pointer move) so it cannot hijack the keyboard highlight', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Host onPick={onPick} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}'); // highlight option 0 via keyboard
    const opts = screen.getAllByRole('option');
    // A list re-rendering under a stationary cursor fires this mouseenter with
    // no preceding mousemove — it must NOT move the highlight.
    fireEvent.mouseEnter(opts[2]!);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(OPTIONS[0]);
  });

  it('honors hover once the pointer genuinely moves', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Host onPick={onPick} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    fireEvent.mouseMove(screen.getByRole('listbox'));
    fireEvent.mouseEnter(screen.getAllByRole('option')[2]!);
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it('click on an option picks it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Host onPick={onPick} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Acme Inc/ }));
    expect(onPick).toHaveBeenCalledWith(OPTIONS[2]);
  });

  it('exposes the ARIA combobox pattern with aria-activedescendant', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowDown}');
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const active = document.getElementById(activeId!);
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveTextContent('Acme GmbH');
  });
});
