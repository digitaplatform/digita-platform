import { afterEach, describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../src/composites/DatePicker.js';

/** A person who works by keyboard, or in German, opens the calendar of a Date field: the paging
 *  buttons say what they do in the caller's language, and the day grid moves with the arrow keys
 *  without the mouse. The weeks start on Monday, as the grid draws them. */

type User = ReturnType<typeof userEvent.setup>;

afterEach(() => {
  vi.useRealTimers();
});

/** A day of the shown month by the number it shows; its accessible name is the full date. */
const byNumber = (n: number) => (_name: string, cell: Element) => cell.textContent === String(n);
const day = (n: number) => screen.getByRole('gridcell', { name: byNumber(n) });
const queryDay = (n: number) => screen.queryByRole('gridcell', { name: byNumber(n) });
const trigger = (name: string) => screen.getByRole('button', { name });

/** Tab onto the trigger, then open the calendar the way a keyboard does. */
async function openByKeyboard(user: User) {
  await user.tab();
  await user.keyboard('{Enter}');
}

/** From the open day grid back to the title, into the month and year view, and onto January. */
async function pickJanuaryByKeyboard(user: User) {
  await openByKeyboard(user);
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  await user.tab({ shift: true });
  await user.keyboard('{Enter}');
  await user.tab();
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Jan' })).toHaveFocus();
  await user.keyboard('{Enter}');
}

describe('DatePicker paging labels', () => {
  it('names the paging buttons by the labels the caller passes', async () => {
    const user = userEvent.setup();
    render(
      <DatePicker
        value="2026-09-28"
        onChange={vi.fn()}
        locale="de-DE"
        previousLabel="Vorheriger Monat"
        nextLabel="Nächster Monat"
      />,
    );
    await user.click(trigger('28.09.2026'));
    expect(screen.getByRole('button', { name: 'Vorheriger Monat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nächster Monat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('keeps Previous and Next when the caller passes no labels, and they still page (innocent case)', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await user.click(trigger('28/09/2026'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'October 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'August 2026' })).toBeInTheDocument();
  });
});

describe('DatePicker day grid by keyboard', () => {
  it('picks a day without the mouse: open, arrow to it, Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-28" onChange={onChange} locale="en-GB" />);
    await openByKeyboard(user);
    expect(day(28)).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(day(29)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-09-29');
    expect(queryDay(29)).toBeNull();
  });

  // 2026-09-30 is a Wednesday; the week runs Monday 28 September to Sunday 4 October.
  it.each([
    ['ArrowRight, into the next month', '2026-09-30', '{ArrowRight}', '2026-10-01'],
    ['ArrowLeft', '2026-09-30', '{ArrowLeft}', '2026-09-29'],
    ['ArrowLeft, into the previous year', '2026-01-01', '{ArrowLeft}', '2025-12-31'],
    ['ArrowDown, a week on', '2026-09-30', '{ArrowDown}', '2026-10-07'],
    ['ArrowUp, a week back', '2026-09-30', '{ArrowUp}', '2026-09-23'],
    ['Home, to the Monday', '2026-09-30', '{Home}', '2026-09-28'],
    ['End, to the Sunday, into the next month', '2026-09-30', '{End}', '2026-10-04'],
    ['PageDown, a month on', '2026-09-30', '{PageDown}', '2026-10-30'],
    ['PageUp, a month back', '2026-09-30', '{PageUp}', '2026-08-30'],
    ['PageDown, to the last day of a shorter month', '2026-03-31', '{PageDown}', '2026-04-30'],
    ['Shift+PageDown, a year on', '2026-09-30', '{Shift>}{PageDown}{/Shift}', '2027-09-30'],
    ['Shift+PageUp, a year back', '2026-09-30', '{Shift>}{PageUp}{/Shift}', '2025-09-30'],
    ['Shift+PageDown, from a leap day', '2028-02-29', '{Shift>}{PageDown}{/Shift}', '2029-02-28'],
  ])('moves the focused day with %s', async (_name, start, keys, picked) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value={start} onChange={onChange} locale="en-GB" />);
    await openByKeyboard(user);
    await user.keyboard(keys);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(picked);
  });

  it('follows the focused day into another month: the title changes and the day has the focus', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-30" onChange={vi.fn()} locale="en-GB" />);
    await openByKeyboard(user);
    expect(screen.getByRole('button', { name: 'September 2026' })).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'October 2026' })).toBeInTheDocument();
    expect(day(1)).toHaveFocus();
  });

  it('keeps a day in the tab order after the mouse pages into a shorter month', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-10-31" onChange={vi.fn()} locale="en-GB" />);
    await openByKeyboard(user);
    expect(day(31)).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'November 2026' })).toBeInTheDocument();
    expect(document.querySelectorAll('.dp-day[tabindex="0"]')).toHaveLength(1);
    expect(day(30)).toHaveAttribute('tabindex', '0');
  });

  it('opens on today when no date is set', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 17, 12));
    const user = userEvent.setup();
    render(<DatePicker onChange={vi.fn()} locale="en-GB" placeholder="Due" />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'September 2026' })).toBeInTheDocument();
    expect(day(17)).toHaveFocus();
  });

  it('keeps one day in the tab order: Tab leaves the grid for the next control', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" clearLabel="Clear date" />);
    await openByKeyboard(user);
    expect(document.querySelectorAll('.dp-day[tabindex="0"]')).toHaveLength(1);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Clear date' })).toHaveFocus();
  });

  it('leaves the keys that carry a modifier to the browser (innocent case)', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await openByKeyboard(user);
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await user.keyboard('{Control>}{ArrowDown}{/Control}');
    await user.keyboard('{Meta>}{ArrowLeft}{/Meta}');
    expect(day(28)).toHaveFocus();
  });

  it('keeps the page from scrolling under the keys it handles, and no others', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await openByKeyboard(user);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(fireEvent.keyDown(document.activeElement!, { key }), key).toBe(false);
    }
    for (const key of ['a', 'Tab', 'Enter']) {
      expect(fireEvent.keyDown(document.activeElement!, { key }), key).toBe(true);
    }
  });
});

describe('DatePicker hands the focus back', () => {
  it('to the trigger after a pick by keyboard', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await openByKeyboard(user);
    expect(day(28)).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(trigger('28/09/2026')).toHaveFocus();
  });

  it('to the trigger when Escape closes the calendar', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await openByKeyboard(user);
    expect(day(28)).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(queryDay(28)).toBeNull();
    expect(trigger('28/09/2026')).toHaveFocus();
  });

  it('to the trigger after Clear by keyboard, which still empties the date', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-28" onChange={onChange} locale="en-GB" clearLabel="Clear date" />);
    await openByKeyboard(user);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(trigger('28/09/2026')).toHaveFocus();
  });

  it('to the day grid after a month pick in the month and year view', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await pickJanuaryByKeyboard(user);
    expect(screen.getByRole('button', { name: 'January 2026' })).toBeInTheDocument();
    expect(day(28)).toHaveFocus();
  });

  it('to the trigger when Escape closes the calendar after a month pick', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />);
    await pickJanuaryByKeyboard(user);
    await user.keyboard('{Escape}');
    expect(queryDay(28)).toBeNull();
    expect(trigger('28/09/2026')).toHaveFocus();
  });

  it('and leaves it to a host that moves the focus on after the pick, as a grid editor does (innocent case)', async () => {
    const user = userEvent.setup();
    function Host() {
      const next = useRef<HTMLInputElement>(null);
      return (
        <>
          <DatePicker value="2026-09-28" onChange={() => next.current?.focus()} locale="en-GB" />
          <input ref={next} aria-label="Next field" />
        </>
      );
    }
    render(<Host />);
    await openByKeyboard(user);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Next field' })).toHaveFocus();
  });

  it('but not when the focus has left the panel: Escape closes it and leaves the focus alone (innocent case)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Reference" />
        <DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />
      </>,
    );
    await user.click(trigger('28/09/2026'));
    expect(day(28)).toHaveFocus();
    act(() => screen.getByRole('textbox', { name: 'Reference' }).focus());

    await user.keyboard('{Escape}');
    expect(queryDay(28)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveFocus();
  });

  it('but not after a click outside: the focus stays where the person put it (innocent case)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <DatePicker value="2026-09-28" onChange={vi.fn()} locale="en-GB" />
        <input aria-label="Reference" />
      </>,
    );
    await openByKeyboard(user);
    expect(day(28)).toHaveFocus();

    await user.click(screen.getByRole('textbox', { name: 'Reference' }));
    expect(queryDay(28)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Reference' })).toHaveFocus();
  });

  it('and still picks with the mouse (innocent case)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-09-28" onChange={onChange} locale="en-GB" />);
    await user.click(trigger('28/09/2026'));
    await user.click(day(3));
    expect(onChange).toHaveBeenCalledWith('2026-09-03');
    expect(queryDay(3)).toBeNull();
  });
});
