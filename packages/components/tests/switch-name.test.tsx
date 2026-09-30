import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../src/primitives/Switch.js';

/** A screen or a plugin renders the Switch with its `label` prop. The label is drawn beside the
 *  switch, so a screen reader has to announce that text as the name of the switch. */

describe('Switch with a label', () => {
  it('is named by its label', () => {
    render(<Switch checked={false} onChange={() => {}} label="Wireless" />);
    expect(screen.getByRole('switch', { name: 'Wireless' })).toBeInTheDocument();
  });

  it('names each of two switches by its own label', () => {
    render(
      <>
        <Switch checked={false} onChange={() => {}} label="Wireless" />
        <Switch checked onChange={() => {}} label="Bluetooth" />
      </>,
    );
    const wireless = screen.getByRole('switch', { name: 'Wireless' });
    const bluetooth = screen.getByRole('switch', { name: 'Bluetooth' });
    expect(wireless).not.toBe(bluetooth);
    expect(wireless).toHaveAttribute('aria-checked', 'false');
    expect(bluetooth).toHaveAttribute('aria-checked', 'true');
  });

  it('is named by a label that is more than text', () => {
    render(<Switch checked={false} onChange={() => {}} label={<strong>Wireless</strong>} />);
    expect(screen.getByRole('switch', { name: 'Wireless' })).toBeInTheDocument();
  });

  it('still toggles from the label text', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Wireless" />);
    await userEvent.setup().click(screen.getByText('Wireless'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Switch named by the caller (innocent cases)', () => {
  it('keeps the name of aria-label when there is no label', () => {
    render(<Switch checked onChange={() => {}} aria-label="Wifi" />);
    expect(screen.getByRole('switch', { name: 'Wifi' })).toBeInTheDocument();
  });

  it('keeps the name of aria-labelledby when there is no label, as the Check control passes it', () => {
    render(
      <>
        <span id="check-label">Shipping</span>
        <Switch checked onChange={() => {}} aria-labelledby="check-label" />
      </>,
    );
    expect(screen.getByRole('switch', { name: 'Shipping' })).toBeInTheDocument();
  });

  it('lets an aria-labelledby of the caller win over the label beside the switch', () => {
    render(
      <>
        <span id="row-title">Notifications</span>
        <Switch checked onChange={() => {}} label="On" aria-labelledby="row-title" />
      </>,
    );
    expect(screen.getByRole('switch', { name: 'Notifications' })).toBeInTheDocument();
  });
});
