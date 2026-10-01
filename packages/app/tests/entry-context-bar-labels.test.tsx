// @vitest-environment jsdom
// The bar under an entry grid labels the values of its view in the session language: each value by
// the text of `field.<view>.<section>.<key>`, and a key without a text as words, never as the key.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useI18nStore } from '@/stores/i18n';

vi.mock('@/services/resource', () => ({
  getView: async () => ({
    success: true,
    status_code: 200,
    messages: [],
    data: {
      source: null,
      sections: {
        stock: { stock_qty: 7, bin_location: 'A-3' },
        price: [{ sale_price: 12.5 }],
        supplier: [{ stock_qty: 40 }],
      },
    },
  }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { EntryContextBar } from '@/controls/EntryContextBar';

function renderBar(translations: Record<string, string>) {
  useI18nStore.setState({ translations, loaded: true });
  return render(<EntryContextBar view="partAvailability" paramsMap={{ part: 'part' }} row={{ part: 'P-1' }} doc={{}} />);
}

describe('EntryContextBar labels', () => {
  it('labels each value by its text, not by the key', async () => {
    renderBar({
      'field.partAvailability.stock.stock_qty': 'Lagerbestand',
      'field.partAvailability.stock.bin_location': 'Lagerplatz',
      'field.partAvailability.price.sale_price': 'Verkaufspreis',
    });

    const bar = await screen.findByTestId('entry-context-bar', undefined, { timeout: 3000 });
    expect(bar).toHaveTextContent('Lagerbestand: 7');
    expect(bar).toHaveTextContent('Lagerplatz: A-3');
    expect(bar).toHaveTextContent('Verkaufspreis: 12.50');
    expect(bar).not.toHaveTextContent('stock_qty');
    expect(bar).not.toHaveTextContent('bin_location');
    expect(bar).not.toHaveTextContent('sale_price');
  });

  it('shows a key without a text as words, never as the key', async () => {
    renderBar({});

    const bar = await screen.findByTestId('entry-context-bar', undefined, { timeout: 3000 });
    expect(bar).toHaveTextContent('Bin Location: A-3');
    expect(bar).toHaveTextContent('Sale Price: 12.50');
  });

  it('gives each entry its own React key, also where two sections carry the same key', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBar({});

    await screen.findByTestId('entry-context-bar', undefined, { timeout: 3000 });
    expect(error.mock.calls.filter(([message]) => String(message).includes('same key'))).toEqual([]);
    error.mockRestore();
  });

  it('keeps two sections that carry the same key apart, each with its own text', async () => {
    renderBar({
      'field.partAvailability.stock.stock_qty': 'Lagerbestand',
      'field.partAvailability.supplier.stock_qty': 'Bestand beim Lieferanten',
    });

    const bar = await screen.findByTestId('entry-context-bar', undefined, { timeout: 3000 });
    expect(bar).toHaveTextContent('Lagerbestand: 7');
    expect(bar).toHaveTextContent('Bestand beim Lieferanten: 40');
  });
});
