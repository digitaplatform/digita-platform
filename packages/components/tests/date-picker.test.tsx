import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../src/composites/DatePicker.js';

describe('DatePicker', () => {
  it('clears a set date: the panel offers Clear, which emits undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-28" onChange={onChange} locale="en-GB" clearLabel="Clear date" />);
    await user.click(screen.getByRole('button', { name: '28/09/2026' }));
    await user.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('offers no Clear while no date is set', async () => {
    const user = userEvent.setup();
    render(<DatePicker onChange={vi.fn()} placeholder="Due" clearLabel="Clear date" />);
    await user.click(screen.getByRole('button', { name: 'Due' }));
    expect(screen.queryByRole('button', { name: 'Clear date' })).toBeNull();
  });
});
