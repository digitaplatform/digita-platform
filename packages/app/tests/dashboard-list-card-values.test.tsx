// @vitest-environment jsdom
// The front desk's Home lists "New bookings from the website". Its preferred date read
// "2026-10-09T08:00:00.000Z", the stored value in UTC, where a list shows the date and time in the
// person's language and time zone. A column that names a field of the card's entity shows its value
// as a list does; a key no field has keeps its text as it is.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EntityDefinition, ListCard as ListCardDef } from '@digitaplatform/shared';
import { useSessionStore } from '@/stores/session';
import { formatDatetime } from '@/lib/format';

const BOOKING = {
  name: 'Booking',
  label: 'Booking',
  fields: [
    { fieldname: 'customer_name', fieldtype: 'Data', label: 'Customer' },
    { fieldname: 'preferred_at', fieldtype: 'Datetime', label: 'Preferred date' },
  ],
  permissions: [],
} as unknown as EntityDefinition;

vi.mock('@/hooks/useMeta', () => ({
  useMeta: (entity?: string) => ({ data: entity === 'Booking' ? BOOKING : undefined, isLoading: false }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import { ListCard } from '@/components/dashboard/ListCard';

afterEach(() => {
  useSessionStore.setState({ locale: null });
});

const card = {
  id: 'web_bookings',
  kind: 'list',
  label: 'New bookings from the website',
  columns: ['customer_name', 'preferred_at', 'open_count'],
} as unknown as ListCardDef;

describe('a dashboard list card', () => {
  it('shows a Datetime field in the language and time zone of the person, and a key without a field as it is', () => {
    useSessionStore.setState({ locale: { code: 'de', format_locale: 'de-CH', timezone: 'Europe/Zurich' } });
    render(
      <ListCard
        card={card}
        status="ready"
        entity="Booking"
        data={[{ _id: 'B-1', customer_name: 'Anna Muster', preferred_at: '2026-10-09T08:00:00.000Z', open_count: 3 }]}
      />,
    );
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual([
      'Anna Muster',
      formatDatetime('2026-10-09T08:00:00.000Z', 'de-CH', 'Europe/Zurich'),
      '3',
    ]);
    expect(cells[1]).toContain('10:00');
    expect(screen.queryByText(/2026-10-09T08/)).not.toBeInTheDocument();
  });
});
