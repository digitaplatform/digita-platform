// @vitest-environment jsdom
// The form shows a stored Datetime in the person's time zone, the time the list shows,
// and stores what the person types as that instant in UTC with its zone.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';
import { useSessionStore } from '@/stores/session';
import { formatDatetime } from '@/lib/format';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import DatetimeControl from '@/controls/DatetimeControl';

afterEach(() => {
  useSessionStore.setState({ locale: null });
});

// Swedish writes a date as YYYY-MM-DD and the time on a 24-hour clock, so the field reads as the
// wall clock text these cases compare.
function inZone(timezone: string | null) {
  useSessionStore.setState({ locale: { code: 'sv', format_locale: 'sv-SE', timezone } });
}

function props(overrides: Partial<FieldControlProps> = {}): FieldControlProps {
  return {
    field: { fieldname: 'preferred_at', fieldtype: 'Datetime', label: 'Preferred at' } as FieldDefinition,
    value: '2026-07-02T07:30:00Z',
    doc: {},
    entity: 'Booking',
    state: { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false },
    onChange: () => {},
    controlId: 'c-preferred_at',
    labelId: 'l-preferred_at',
    ...overrides,
  };
}

function draw(overrides: Partial<FieldControlProps> = {}) {
  const view = render(
    <>
      <span id="l-preferred_at">Preferred at</span>
      <DatetimeControl {...props(overrides)} />
    </>,
  );
  const box = within(view.container);
  const time = () => box.getByRole('textbox', { name: 'Preferred at ui.datetime.time' });
  return {
    ...view,
    /** The wall clock the field shows, as `YYYY-MM-DDTHH:mm`. */
    shown: () => `${box.getByRole('button', { name: 'Preferred at' }).textContent}T${(time() as HTMLInputElement).value}`,
    /** Types a time and leaves the box, as a person does. */
    typeTime: async (text: string) => {
      await userEvent.clear(time());
      await userEvent.type(time(), text);
      await userEvent.tab();
    },
  };
}

describe('DatetimeControl', () => {
  it('shows the stored instant in the time zone of the person', () => {
    inZone('Europe/Zurich');
    expect(draw().shown()).toBe('2026-07-02T09:30');
  });

  it('shows the hour the list shows', () => {
    inZone('Europe/Zurich');
    expect(formatDatetime('2026-07-02T07:30:00Z', 'en-GB', 'Europe/Zurich')).toContain('09:30');
    expect(draw().shown().slice(11)).toBe('09:30');
  });

  it('follows the winter offset and the day change at midnight', () => {
    inZone('Europe/Zurich');
    const winter = draw({ value: '2026-01-15T08:00:00Z' });
    expect(winter.shown()).toBe('2026-01-15T09:00');
    winter.unmount();
    expect(draw({ value: '2026-07-01T22:00:00.000Z' }).shown()).toBe('2026-07-02T00:00');
  });

  it('stores what the person types as the UTC instant of their time zone', async () => {
    inZone('Europe/Zurich');
    const onChange = vi.fn();
    const summer = draw({ value: '2026-07-02T05:00:00Z', onChange });
    await summer.typeTime('09:30');
    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T07:30:00.000Z');
    summer.unmount();
    const winter = draw({ value: '2026-01-15T05:00:00Z', onChange });
    await winter.typeTime('09:00');
    expect(onChange).toHaveBeenLastCalledWith('2026-01-15T08:00:00.000Z');
  });

  it('stores a wall time a clock change repeats as its later instant, one it skips an hour on', async () => {
    inZone('Europe/Zurich');
    const onChange = vi.fn();
    const autumn = draw({ value: '2026-10-25T10:00:00Z', onChange });
    await autumn.typeTime('02:30');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-25T01:30:00.000Z');
    autumn.unmount();
    const spring = draw({ value: '2026-03-29T10:00:00Z', onChange });
    await spring.typeTime('02:30');
    expect(onChange).toHaveBeenLastCalledWith('2026-03-29T01:30:00.000Z');
  });

  it('reads and writes in a zone west of UTC', async () => {
    inZone('America/New_York');
    const onChange = vi.fn();
    const field = draw({ onChange });
    expect(field.shown()).toBe('2026-07-02T03:30');
    await field.typeTime('23:15');
    expect(onChange).toHaveBeenLastCalledWith('2026-07-03T03:15:00.000Z');
  });

  it('uses the time zone of the browser when the person has none, as the list does', async () => {
    inZone(null);
    const onChange = vi.fn();
    const field = draw({ onChange });
    expect(field.shown()).toBe(browserLocal('2026-07-02T07:30:00Z'));
    await field.typeTime(browserLocal('2026-07-02T08:45:00Z').slice(11));
    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T08:45:00.000Z');
  });

  it('emits undefined when cleared and shows an empty field for no value', async () => {
    inZone('Europe/Zurich');
    const onChange = vi.fn();
    const field = draw({ onChange });
    await userEvent.click(screen.getByRole('button', { name: 'Preferred at' }));
    await userEvent.click(screen.getByRole('button', { name: 'ui.action.clear' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    field.unmount();
    expect(draw({ value: null }).shown()).toBe('T');
  });
});

/** The wall clock text of an instant in the zone the test runs in. */
function browserLocal(iso: string): string {
  const local = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
}
