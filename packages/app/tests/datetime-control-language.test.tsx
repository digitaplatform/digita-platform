// @vitest-environment jsdom
// A German-speaking person opens a record with a Datetime field. It shows and takes the date and the
// time as the app writes them in German, like the Date field beside it, not in the browser's
// language. An English-speaking person reads them the English way.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';
import { useSessionStore } from '@/stores/session';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import DatetimeControl from '@/controls/DatetimeControl';

afterEach(() => {
  useSessionStore.setState({ locale: null });
});

function speaking(language: string) {
  useSessionStore.setState({ locale: { code: language, format_locale: language, timezone: 'Europe/Zurich' } });
}

function drawField(overrides: Partial<FieldControlProps> = {}) {
  const props: FieldControlProps = {
    field: { fieldname: 'preferred_at', fieldtype: 'Datetime', label: 'Preferred at' } as FieldDefinition,
    value: '2026-10-01T16:05:00Z',
    doc: {},
    entity: 'Booking',
    state: { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false },
    onChange: () => {},
    controlId: 'preferred_at',
    labelId: 'preferred_at-label',
    ...overrides,
  };
  render(
    <>
      <span id="preferred_at-label">Preferred at</span>
      <DatetimeControl {...props} />
    </>,
  );
  return {
    date: () => screen.getByRole('button', { name: 'Preferred at' }),
    time: () => screen.getByRole('textbox', { name: 'Preferred at ui.datetime.time' }),
  };
}

describe('a Datetime field in the language of the app', () => {
  it('shows date and time the German way', () => {
    speaking('de');
    const { date, time } = drawField();
    expect(date()).toHaveTextContent('01.10.2026');
    expect(time()).toHaveValue('18:05');
  });

  it('shows date and time the English way', () => {
    speaking('en');
    const { date, time } = drawField();
    expect(date()).toHaveTextContent('10/01/2026');
    expect(time()).toHaveValue('06:05 PM');
  });

  it('takes a time typed the German way as the instant of the person', async () => {
    speaking('de');
    const onChange = vi.fn();
    const { time } = drawField({ onChange });
    await userEvent.clear(time());
    await userEvent.type(time(), '19.30');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01T17:30:00.000Z');
  });

  it('takes a time typed the English way as the instant of the person', async () => {
    speaking('en');
    const onChange = vi.fn();
    const { time } = drawField({ onChange });
    await userEvent.clear(time());
    await userEvent.type(time(), '7:30 pm');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith('2026-10-01T17:30:00.000Z');
  });

  it('keeps the time when the person picks another day', async () => {
    speaking('de');
    const onChange = vi.fn();
    const { date } = drawField({ onChange });
    await userEvent.click(date());
    await userEvent.click(screen.getByRole('gridcell', { name: 'Freitag, 2. Oktober 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10-02T16:05:00.000Z');
  });

  it('marks a time it cannot read and stores nothing', async () => {
    speaking('de');
    const onChange = vi.fn();
    const { time } = drawField({ onChange });
    await userEvent.clear(time());
    await userEvent.type(time(), '25:00');
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(time()).toHaveAttribute('aria-invalid', 'true');
  });
});
