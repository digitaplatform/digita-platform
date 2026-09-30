// @vitest-environment jsdom
// A Duration is stored as whole seconds. `hide_days` folds the days into the hours
// and `hide_seconds` drops the seconds, in the form control as in the list and grid
// cells, because all three draw the value through `formatDuration`.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';
import DurationControl from '@/controls/DurationControl';
import { formatDuration, parseDuration } from '@/lib/format';

/** 1 day, 2 hours, 3 minutes, 4 seconds. */
const SECONDS = 86400 + 2 * 3600 + 3 * 60 + 4;
const KEYS = [{}, { hide_days: true }, { hide_seconds: true }, { hide_days: true, hide_seconds: true }];

describe('formatDuration honors hide_days and hide_seconds', () => {
  it('shows days, hours, minutes and seconds without the keys', () => {
    expect(formatDuration(SECONDS)).toBe('1d:2:03:04');
  });
  it('folds the days into the hours with hide_days', () => {
    expect(formatDuration(SECONDS, { hide_days: true })).toBe('26:03:04');
  });
  it('drops the seconds with hide_seconds', () => {
    expect(formatDuration(SECONDS, { hide_seconds: true })).toBe('1d:2:03');
  });
  it('does both with both keys', () => {
    expect(formatDuration(SECONDS, { hide_days: true, hide_seconds: true })).toBe('26:03');
  });
  it('shows a value that is no duration as it is', () => {
    expect(formatDuration('abc')).toBe('abc');
    expect(formatDuration(-5)).toBe('-5');
  });
});

describe('parseDuration reads what formatDuration writes', () => {
  for (const keys of KEYS) {
    it(`reads the text back with ${JSON.stringify(keys)}`, () => {
      const shown = keys.hide_seconds ? SECONDS - 4 : SECONDS;
      expect(parseDuration(formatDuration(SECONDS, keys), keys)).toBe(shown);
    });
  }
  it('counts a plain number in the smallest unit shown', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('90', { hide_seconds: true })).toBe(5400);
  });
  it('answers undefined for text that is no duration', () => {
    for (const text of ['abc', '1:2:3:4', '-5', '1.5', '']) expect(parseDuration(text)).toBeUndefined();
    expect(parseDuration('1:2:3', { hide_seconds: true })).toBeUndefined();
  });
});

function props(field: Partial<FieldDefinition>, overrides: Partial<FieldControlProps> = {}): FieldControlProps {
  return {
    field: { fieldname: 'loan_period', fieldtype: 'Duration', label: 'Loan period', ...field } as FieldDefinition,
    value: SECONDS,
    doc: {},
    entity: 'Loan',
    state: { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false },
    onChange: () => {},
    controlId: 'c-loan_period',
    labelId: 'l-loan_period',
    ...overrides,
  };
}
const input = (container: HTMLElement) => container.querySelector('input') as HTMLInputElement;

describe('DurationControl honors hide_days and hide_seconds', () => {
  for (const keys of KEYS) {
    it(`shows the stored seconds as formatDuration does with ${JSON.stringify(keys)}`, () => {
      const { container } = render(<DurationControl {...props(keys)} />);
      expect(input(container).value).toBe(formatDuration(SECONDS, keys));
    });
  }

  it('stores what the person types as seconds, in the units the field shows', () => {
    const onChange = vi.fn();
    const { container } = render(<DurationControl {...props({ hide_seconds: true }, { onChange })} />);
    fireEvent.change(input(container), { target: { value: '1:30' } });
    expect(onChange).toHaveBeenLastCalledWith(5400);
    expect(input(container).value).toBe('1:30');
    fireEvent.change(input(container), { target: { value: '2d:1:00' } });
    expect(onChange).toHaveBeenLastCalledWith(2 * 86400 + 3600);
  });

  it('stores nothing for an emptied input, and the text as typed when it is no duration', () => {
    const onChange = vi.fn();
    const { container } = render(<DurationControl {...props({}, { onChange })} />);
    fireEvent.change(input(container), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(input(container), { target: { value: 'soon' } });
    expect(onChange).toHaveBeenLastCalledWith('soon');
  });

  it('shows the stored value in its own format again once the input loses focus', () => {
    const { container, rerender } = render(<DurationControl {...props({ hide_days: true })} />);
    fireEvent.change(input(container), { target: { value: '26:3:4' } });
    rerender(<DurationControl {...props({ hide_days: true }, { value: SECONDS })} />);
    expect(input(container).value).toBe('26:3:4');
    fireEvent.blur(input(container));
    expect(input(container).value).toBe('26:03:04');
  });

  it('reads the first character a grid seeds as text in the units the field shows', () => {
    const onChange = vi.fn();
    const { container } = render(<DurationControl {...props({ hide_seconds: true }, { value: '5', onChange, inGrid: true })} />);
    expect(input(container).value).toBe('5');
    expect(onChange).toHaveBeenLastCalledWith(300);
  });
});
