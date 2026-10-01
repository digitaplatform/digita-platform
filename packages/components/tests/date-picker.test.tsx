import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

/** A screen reader user opens the calendar of a Date field: the panel is a dialog named by the
 *  field, and the days form a grid of rows under weekday column headers, each day named by its full
 *  date and the set one marked selected. */
describe('DatePicker for a screen reader', () => {
  function renderField(value?: string) {
    return render(
      <>
        <span id="due-label">Due date</span>
        <DatePicker value={value} onChange={vi.fn()} locale="en-GB" aria-labelledby="due-label" />
      </>,
    );
  }

  it('opens a dialog named by the field label', async () => {
    const user = userEvent.setup();
    renderField('2026-09-28');
    const trigger = screen.getByRole('button', { name: 'Due date' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Due date' })).toBeInTheDocument();
  });

  it('names the focused day by its full date, as the selected cell of a grid named by the month', async () => {
    const user = userEvent.setup();
    renderField('2026-09-28');
    await user.click(screen.getByRole('button', { name: 'Due date' }));
    const grid = screen.getByRole('grid', { name: 'September 2026' });
    const focused = document.activeElement as HTMLElement;
    expect(grid).toContainElement(focused);
    expect(focused).toHaveAttribute('role', 'gridcell');
    expect(focused).toHaveAccessibleName(/^Monday,? 28 September 2026$/);
    expect(focused).toHaveAttribute('aria-selected', 'true');
    expect(within(grid).getAllByRole('gridcell', { selected: true })).toEqual([focused]);
  });

  it('draws a header row of the weekdays and a row of seven cells for each week', async () => {
    const user = userEvent.setup();
    renderField('2026-09-28');
    await user.click(screen.getByRole('button', { name: 'Due date' }));
    const [header, ...weeks] = within(screen.getByRole('grid')).getAllByRole('row');
    const columns = within(header!).getAllByRole('columnheader');
    expect(columns.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
    // September 2026 starts on a Tuesday and spans five weeks.
    expect(weeks).toHaveLength(5);
    for (const week of weeks) expect(within(week).getAllByRole('gridcell')).toHaveLength(7);
    expect(within(weeks[0]!).getAllByRole('gridcell')[1]).toHaveAccessibleName(/^Tuesday,? 1 September 2026$/);
  });

  it('marks no day selected while no date is set (innocent case)', async () => {
    const user = userEvent.setup();
    renderField();
    await user.click(screen.getByRole('button', { name: 'Due date' }));
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('gridcell', { selected: true })).toHaveLength(0);
  });
});
