// @vitest-environment jsdom
// A German clerk prints from a record whose entity links two reports. Each entry of the print menu
// names its link, and the entity file writes that name once, in English. An app translates it in its
// locale files under report.<Entity>.<report>, as it translates a field under field.<Entity>.<field>
// and an action under action.<Entity>.<action>; without that lookup the German menu reads "Invoice"
// and "Delivery note".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';
import { readBundle } from '@digitaplatform/shared/i18n-node';
import { useI18nStore } from '@/stores/i18n';

vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: { roles: ['Clerk'] } }),
}));

import { PrintMenu } from '@/components/workflow/PrintMenu';
import { RowPrintButton } from '@/components/workflow/RowPrintButton';

// tests/setup.ts stops the run without it.
const texts = readBundle(process.env.TRANSLATIONS_DIR!);
const PRINT_IN_GERMAN = texts.de!['ui.action.print']!;

const INVOICE_LINK: EntityReportLink = { report: 'invoice', label: 'Invoice', param_map: { invoice: '_id' } };
const DELIVERY_LINK: EntityReportLink = { report: 'delivery-note', label: 'Delivery note', param_map: { invoice: '_id' } };
const PACKING_LINK: EntityReportLink = { report: 'packing-slip', label: 'Packing slip' };

const GERMAN_LABELS = {
  'report.Invoice.invoice': 'Rechnung',
  'report.Invoice.delivery-note': 'Lieferschein',
  // The same report linked from another entity has a key of its own.
  'report.Order.invoice': 'Auftragsrechnung',
};

const DOC = { _id: 'INV-7', docstatus: 1 };

function buildMeta(reports: EntityReportLink[]): EntityDefinition {
  return {
    name: 'Invoice',
    label: 'Rechnung',
    fields: [],
    reports,
    permissions: [{ role: 'Clerk', level: 0, read: 1, print: 1 }],
  } as unknown as EntityDefinition;
}

async function openMenu(reports: EntityReportLink[]) {
  const user = userEvent.setup();
  render(<PrintMenu meta={buildMeta(reports)} doc={DOC} />);
  await user.click(screen.getByRole('button', { name: PRINT_IN_GERMAN }));
  return user;
}

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
  useI18nStore.setState({ locale: 'de', translations: GERMAN_LABELS });
});

afterEach(() => {
  vi.restoreAllMocks();
  useI18nStore.setState({ locale: 'en', translations: {} });
});

describe('the print menu of an entity with two report links, in German', () => {
  it('names each entry by the German label of its link', async () => {
    await openMenu([INVOICE_LINK, DELIVERY_LINK]);

    const entries = [screen.getByTestId('action:print:invoice'), screen.getByTestId('action:print:delivery-note')];
    expect(entries.map((entry) => entry.textContent)).toEqual(['Rechnung', 'Lieferschein']);
  });

  it('titles the preview of the picked entry by its German label', async () => {
    const user = await openMenu([INVOICE_LINK, DELIVERY_LINK]);

    await user.click(screen.getByTestId('action:print:delivery-note'));

    expect(await screen.findByRole('dialog', { name: 'Lieferschein' })).toBeInTheDocument();
  });

  it('keeps the written label of a link whose key the locale lacks', async () => {
    await openMenu([INVOICE_LINK, PACKING_LINK]);

    expect(screen.getByTestId('action:print:packing-slip')).toHaveTextContent('Packing slip');
    expect(screen.getByTestId('action:print:invoice')).toHaveTextContent('Rechnung');
  });

  it('names a link that has no written label by its key, and by its report without one', async () => {
    await openMenu([{ report: 'invoice' }, { report: 'packing-slip' }]);

    expect(screen.getByTestId('action:print:invoice')).toHaveTextContent('Rechnung');
    expect(screen.getByTestId('action:print:packing-slip')).toHaveTextContent('packing-slip');
  });
});

describe('the print button of an entity with one report link, in German', () => {
  it('is named by the German label of the link', () => {
    render(<PrintMenu meta={buildMeta([INVOICE_LINK])} doc={DOC} />);

    expect(screen.getByRole('button', { name: 'Rechnung' })).toBeInTheDocument();
  });
});

describe('the print button of a list row, in German', () => {
  function drawRowButton(entity: string, link: EntityReportLink) {
    render(
      <MemoryRouter initialEntries={[`/${entity}`]}>
        <Routes>
          <Route path="/:entity" element={<RowPrintButton link={link} doc={DOC} onPrint={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('is named by the German label of the link of the listed entity', () => {
    drawRowButton('Invoice', INVOICE_LINK);
    expect(screen.getByRole('button', { name: 'Rechnung' })).toBeInTheDocument();
  });

  it('reads the key of the listed entity, not of another entity linking the same report', () => {
    drawRowButton('Order', INVOICE_LINK);
    expect(screen.getByRole('button', { name: 'Auftragsrechnung' })).toBeInTheDocument();
  });
});
