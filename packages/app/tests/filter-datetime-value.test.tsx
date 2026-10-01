// @vitest-environment jsdom
// A list filter on a Datetime is typed on the wall clock of the person's time zone and
// applied as its UTC instant, as the form stores the value: a booking a person in Zurich
// saved at 09:30 (07:30 UTC) is found by "after 09:00", not missed because 09:00 was read
// as UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { FilterTuple } from '@/lib/filter-from-url';
import { useSessionStore } from '@/stores/session';
import { formatDatetime } from '@/lib/format';

vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label, tOption: (_e: string, _f: string, o: string) => o }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

const { FilterEditor } = await import('@/components/list/FilterEditor');
const { FilterChip } = await import('@/components/list/FilterChip');

const META = {
  name: 'Booking',
  module: 'core',
  database: 'app',
  naming: { strategy: 'system' },
  fields: [
    { fieldname: 'booked_at', fieldtype: 'Datetime', label: 'Booked at' },
    { fieldname: 'day', fieldtype: 'Date', label: 'Day' },
  ],
  permissions: [],
} as unknown as EntityDefinition;

beforeEach(() => {
  useSessionStore.setState({ locale: { code: 'en', format_locale: 'en-GB', timezone: 'Europe/Zurich' } });
});

afterEach(() => {
  useSessionStore.setState({ locale: null });
});

function drawEditor(filter: FilterTuple) {
  const onChange = vi.fn();
  render(<FilterEditor meta={META} filter={filter} onChange={onChange} onRemove={() => {}} />);
  return onChange;
}

describe('a Datetime list filter', () => {
  it('applies the wall time typed as its UTC instant in the time zone of the person', () => {
    const onChange = drawEditor(['booked_at', '>', '']);
    fireEvent.change(screen.getByLabelText('ui.filter.value'), { target: { value: '2026-07-02T09:00' } });
    expect(onChange).toHaveBeenLastCalledWith(['booked_at', '>', '2026-07-02T07:00:00.000Z']);
  });

  it('shows an applied instant on the wall clock of the person', () => {
    drawEditor(['booked_at', '>', '2026-07-02T07:00:00.000Z']);
    expect(screen.getByLabelText('ui.filter.value')).toHaveValue('2026-07-02T09:00');
  });

  it('applies and shows both ends of a range the same way', () => {
    const onChange = drawEditor(['booked_at', 'between', ['2026-07-01T22:00:00.000Z', '']]);
    expect(screen.getByLabelText('ui.filter.rangeLow')).toHaveValue('2026-07-02T00:00');
    fireEvent.change(screen.getByLabelText('ui.filter.rangeHigh'), { target: { value: '2026-07-02T18:00' } });
    expect(onChange).toHaveBeenLastCalledWith(['booked_at', 'between', ['2026-07-01T22:00:00.000Z', '2026-07-02T16:00:00.000Z']]);
  });

  it('takes the filter value away when the input is cleared', () => {
    const onChange = drawEditor(['booked_at', '>', '2026-07-02T07:00:00.000Z']);
    fireEvent.change(screen.getByLabelText('ui.filter.value'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(['booked_at', '>', '']);
  });

  it('leaves a Date filter as the day typed', () => {
    const onChange = drawEditor(['day', '>', '']);
    fireEvent.change(screen.getByLabelText('ui.filter.value'), { target: { value: '2026-07-02' } });
    expect(onChange).toHaveBeenLastCalledWith(['day', '>', '2026-07-02']);
  });

  it('shows an applied instant in its chip as the list shows it', () => {
    render(<FilterChip meta={META} filter={['booked_at', '>', '2026-07-02T07:00:00.000Z']} onRemove={() => {}} />);
    const shown = formatDatetime('2026-07-02T07:00:00.000Z', 'en-GB', 'Europe/Zurich');
    expect(shown).toContain('09:00');
    expect(document.querySelector('[data-ui="chip-value"]')).toHaveTextContent(shown);
  });
});
