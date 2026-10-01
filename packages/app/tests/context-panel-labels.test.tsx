// @vitest-environment jsdom
// The context panel labels what a view returns in the session language, never by the keys of the
// result: a section is headed by the text of `field.<view>.<section>`, a value by the text of
// `field.<view>.<section>.<key>`, and a key without a text reads as words, not as the key.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { EntityDefinition } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';

vi.mock('@/services/resource', () => ({
  getView: async () => ({
    success: true,
    status_code: 200,
    messages: [],
    data: {
      source: { _id: 'C-1', display_name: 'Sample Co' },
      sections: {
        customer: { display_name: 'Sample Co', customer_group: 'Retail', credit_limit: 5000 },
        open_orders: [
          { _id: 'WO-1', order_no: 'A-100', stage: 'In repair', total: 120 },
          { _id: 'WO-2', order_no: 'A-101', stage: 'Ready', total: 80 },
        ],
      },
    },
  }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { ContextPanel } from '@/components/record/ContextPanel';

const META = {
  name: 'WorkOrder',
  module: 'core',
  database: 'app',
  naming: { strategy: 'system' },
  fields: [
    {
      fieldname: 'customer',
      fieldtype: 'Link',
      label: 'Customer',
      target: 'Customer',
      context_view: 'customer360',
      context_title: 'About the customer',
    },
  ],
  permissions: [],
} as unknown as EntityDefinition;

function renderPanel(translations: Record<string, string>) {
  useI18nStore.setState({ translations, loaded: true });
  return render(<ContextPanel entity="WorkOrder" meta={META} doc={{ customer: 'C-1' }} />);
}

const FRENCH = {
  'field.customer360.customer': 'Client',
  'field.customer360.customer.display_name': 'Nom affiché',
  'field.customer360.open_orders': 'Commandes ouvertes',
};

const GERMAN = {
  'field.customer360.customer': 'Kunde',
  'field.customer360.customer.display_name': 'Anzeigename',
  'field.customer360.customer.customer_group': 'Kundengruppe',
  'field.customer360.open_orders': 'Offene Aufträge',
  'field.customer360.open_orders.order_no': 'Auftrag',
  'field.customer360.open_orders.stage': 'Stufe',
};

describe('ContextPanel labels', () => {
  it('heads a section by its text and labels each value by its text, not by the key', async () => {
    renderPanel(GERMAN);

    const customer = (await screen.findByText('Kunde')).parentElement!;
    expect(within(customer).getByText('Anzeigename').nextElementSibling).toHaveTextContent('Sample Co');
    expect(within(customer).getByText('Kundengruppe').nextElementSibling).toHaveTextContent('Retail');
    expect(screen.queryByText('display_name')).not.toBeInTheDocument();
    expect(screen.queryByText('customer_group')).not.toBeInTheDocument();
  });

  it('heads each column of a section of rows by its text', async () => {
    renderPanel(GERMAN);

    const orders = (await screen.findByText('Offene Aufträge')).parentElement!;
    // The panel shows the first three keys of a row, `_id` among them, and `_id` has no text here.
    expect(within(orders).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Id',
      'Auftrag',
      'Stufe',
    ]);
    expect(within(orders).getByText('A-100')).toBeInTheDocument();
    expect(screen.queryByText('order_no')).not.toBeInTheDocument();
    expect(screen.queryByText('_id')).not.toBeInTheDocument();
  });

  it('gives a column header its text as a title, because a long text is cut to the column', async () => {
    renderPanel(GERMAN);

    const orders = (await screen.findByText('Offene Aufträge')).parentElement!;
    const headers = within(orders).getAllByRole('columnheader');
    expect(headers[1]).toHaveAttribute('title', 'Auftrag');
    expect(headers[2]).toHaveAttribute('title', 'Stufe');
  });

  it('shows a key without a text as words, never as the key', async () => {
    renderPanel(GERMAN);

    expect(await screen.findByText('Credit Limit')).toBeInTheDocument();
    expect(screen.queryByText('credit_limit')).not.toBeInTheDocument();
  });

  it('follows the language the texts are in', async () => {
    const { rerender } = renderPanel(GERMAN);
    await screen.findByText('Kunde');

    useI18nStore.setState({ translations: FRENCH });
    rerender(<ContextPanel entity="WorkOrder" meta={META} doc={{ customer: 'C-1' }} />);

    expect(await screen.findByText('Client')).toBeInTheDocument();
    expect(screen.getByText('Nom affiché')).toBeInTheDocument();
    expect(screen.getByText('Commandes ouvertes')).toBeInTheDocument();
    expect(screen.queryByText('Kunde')).not.toBeInTheDocument();
    expect(screen.queryByText('Anzeigename')).not.toBeInTheDocument();
  });
});
