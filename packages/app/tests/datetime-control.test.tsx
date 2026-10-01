// @vitest-environment jsdom
// The form shows a stored Datetime in the person's time zone, the time the list shows,
// and stores what the person types as that instant in UTC with its zone.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';
import DatetimeControl from '@/controls/DatetimeControl';
import { useSessionStore } from '@/stores/session';
import { formatDatetime } from '@/lib/format';

afterEach(() => {
  useSessionStore.setState({ locale: null });
});

function inZone(timezone: string | null) {
  useSessionStore.setState({ locale: { code: 'en', format_locale: 'en', timezone } });
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
const input = (container: HTMLElement) => container.querySelector('input') as HTMLInputElement;

describe('DatetimeControl', () => {
  it('shows the stored instant in the time zone of the person', () => {
    inZone('Europe/Zurich');
    const { container } = render(<DatetimeControl {...props()} />);
    expect(input(container).value).toBe('2026-07-02T09:30');
  });

  it('shows the hour the list shows', () => {
    inZone('Europe/Zurich');
    const { container } = render(<DatetimeControl {...props()} />);
    expect(formatDatetime('2026-07-02T07:30:00Z', 'en-GB', 'Europe/Zurich')).toContain('09:30');
    expect(input(container).value.slice(11)).toBe('09:30');
  });

  it('follows the winter offset and the day change at midnight', () => {
    inZone('Europe/Zurich');
    const winter = render(<DatetimeControl {...props({ value: '2026-01-15T08:00:00Z' })} />);
    expect(input(winter.container).value).toBe('2026-01-15T09:00');
    winter.unmount();
    const midnight = render(<DatetimeControl {...props({ value: '2026-07-01T22:00:00.000Z' })} />);
    expect(input(midnight.container).value).toBe('2026-07-02T00:00');
  });

  it('stores what the person types as the UTC instant of their time zone', () => {
    inZone('Europe/Zurich');
    const onChange = vi.fn();
    const { container } = render(<DatetimeControl {...props({ value: null, onChange })} />);
    fireEvent.change(input(container), { target: { value: '2026-07-02T09:30' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T07:30:00.000Z');
    fireEvent.change(input(container), { target: { value: '2026-01-15T09:00' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-01-15T08:00:00.000Z');
  });

  it('stores a wall time a clock change repeats as its later instant, one it skips an hour on', () => {
    inZone('Europe/Zurich');
    const onChange = vi.fn();
    const { container } = render(<DatetimeControl {...props({ value: null, onChange })} />);
    fireEvent.change(input(container), { target: { value: '2026-10-25T02:30' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-10-25T01:30:00.000Z');
    fireEvent.change(input(container), { target: { value: '2026-03-29T02:30' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-03-29T01:30:00.000Z');
  });

  it('reads and writes in a zone west of UTC', () => {
    inZone('America/New_York');
    const onChange = vi.fn();
    const { container } = render(<DatetimeControl {...props({ onChange })} />);
    expect(input(container).value).toBe('2026-07-02T03:30');
    fireEvent.change(input(container), { target: { value: '2026-07-01T23:15' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T03:15:00.000Z');
  });

  it('uses the time zone of the browser when the person has none, as the list does', () => {
    inZone(null);
    const onChange = vi.fn();
    const { container } = render(<DatetimeControl {...props({ onChange })} />);
    expect(input(container).value).toBe(browserLocal('2026-07-02T07:30:00Z'));
    fireEvent.change(input(container), { target: { value: browserLocal('2026-07-02T08:45:00Z') } });
    expect(onChange).toHaveBeenLastCalledWith('2026-07-02T08:45:00.000Z');
  });

  it('emits undefined when cleared and shows an empty field for no value', () => {
    inZone('Europe/Zurich');
    const onChange = vi.fn();
    const { container } = render(<DatetimeControl {...props({ onChange })} />);
    fireEvent.change(input(container), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    const empty = render(<DatetimeControl {...props({ value: null })} />);
    expect(input(empty.container).value).toBe('');
  });
});

/** The `datetime-local` text of an instant in the zone the test runs in. */
function browserLocal(iso: string): string {
  const local = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
}
