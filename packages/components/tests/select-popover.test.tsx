import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../src/primitives/Select.js';
import { Menu, MenuItem } from '../src/composites/Menu.js';
import { BaseDialog } from '../src/composites/BaseDialog.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('Select on Popover', () => {
  it('portals the option list to document.body', async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="select-parent">
        <Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />
      </div>,
    );
    await user.click(screen.getByRole('combobox', { name: 'pick' }));
    const listbox = screen.getByRole('listbox');
    expect(screen.getByTestId('select-parent')).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
  });

  it('keyboard behavior unchanged: ArrowDown + Enter chooses the next option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={OPTIONS} aria-label="pick" />);
    const trigger = screen.getByRole('combobox', { name: 'pick' });
    await user.click(trigger); // opens, active = selected (a)
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('Escape inside a BaseDialog closes only the Select, not the dialog', async () => {
    const user = userEvent.setup();
    const onDialogClose = vi.fn();
    render(
      <BaseDialog open onClose={onDialogClose} title="Form">
        <Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />
      </BaseDialog>,
    );
    await user.click(screen.getByRole('combobox', { name: 'pick' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onDialogClose).not.toHaveBeenCalled();
  });
});

describe('Select size', () => {
  it('defaults to the md trigger; size="sm" compacts it to h-8 / text-xs', () => {
    const { rerender } = render(<Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />);
    const trigger = screen.getByRole('combobox', { name: 'pick' });
    expect(trigger.className).toContain('py-2.5');
    expect(trigger.className).toContain('text-sm');
    rerender(<Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" size="sm" />);
    expect(trigger.className).toContain('h-8');
    expect(trigger.className).toContain('text-xs');
  });

  it('size="sm" leaves the menu options at their normal density', async () => {
    const user = userEvent.setup();
    render(<Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" size="sm" />);
    await user.click(screen.getByRole('combobox', { name: 'pick' }));
    expect(screen.getByRole('option', { name: 'Beta' }).className).toContain('text-sm');
  });
});

describe('Menu on Popover', () => {
  it('portals the panel and Escape closes only the menu inside a dialog', async () => {
    const user = userEvent.setup();
    const onDialogClose = vi.fn();
    render(
      <BaseDialog open onClose={onDialogClose} title="Host">
        <div data-testid="menu-parent">
          <Menu label="row menu" trigger={<span>⋯</span>}>
            {(close) => (
              <MenuItem
                onSelect={() => {
                  close();
                }}
              >
                Action
              </MenuItem>
            )}
          </Menu>
        </div>
      </BaseDialog>,
    );
    await user.click(screen.getByRole('button', { name: 'row menu' }));
    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('menu-parent')).not.toContainElement(menu);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onDialogClose).not.toHaveBeenCalled();
  });
});
