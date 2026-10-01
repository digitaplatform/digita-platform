// @vitest-environment jsdom
// A receptionist prints the invoice of a French-speaking customer. The invoice report is written in
// German and carries a French overlay, and the report service renders the locale it is sent: the
// print link names the document field that holds the customer's language, and the app sends its value
// as `locale`. The report service refuses a locale on a csv export, so the csv download sends none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';

vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: { roles: ['Clerk'] } }),
}));

import { PrintMenu } from '@/components/workflow/PrintMenu';
import { REPORT_URL, reportRenderUrl, resolveReportParams } from '@/lib/report-link';

type Doc = Record<string, unknown>;

const RENDER = `${REPORT_URL}/api/v1/report/definitions/invoice/render`;

const INVOICE_LINK: EntityReportLink = {
  report: 'invoice',
  label: 'Invoice',
  param_map: { invoice: '_id' },
  locale: 'customer_language',
  formats: ['pdf', 'png', 'csv'],
};

const FRENCH_INVOICE = { _id: 'INV-7', customer_language: 'fr' };

function addressOf(link: EntityReportLink, doc: Doc, format: 'html' | 'pdf' | 'png' | 'csv', print = false): string {
  return reportRenderUrl(link.report, resolveReportParams(link, doc), format, { print });
}

describe('the address of a print link that names the language of the document', () => {
  it.each(['html', 'pdf', 'png'] as const)('sends the language of the document with %s', (format) => {
    expect(addressOf(INVOICE_LINK, FRENCH_INVOICE, format)).toBe(`${RENDER}?format=${format}&invoice=INV-7&locale=fr`);
  });

  it('sends it with the self-printing variant', () => {
    expect(addressOf(INVOICE_LINK, FRENCH_INVOICE, 'html', true)).toBe(`${RENDER}?format=html&invoice=INV-7&locale=fr&print=1`);
  });

  it('sends no language with csv', () => {
    expect(addressOf(INVOICE_LINK, FRENCH_INVOICE, 'csv')).toBe(`${RENDER}?format=csv&invoice=INV-7`);
  });

  it('sends a language with its region as the document holds it', () => {
    expect(addressOf(INVOICE_LINK, { ...FRENCH_INVOICE, customer_language: 'fr-CH' }, 'pdf')).toBe(
      `${RENDER}?format=pdf&invoice=INV-7&locale=fr-CH`,
    );
  });

  it('follows a nested path to the language', () => {
    const link = { ...INVOICE_LINK, locale: 'customer.language' };
    expect(addressOf(link, { _id: 'INV-7', customer: { language: 'it' } }, 'pdf')).toBe(`${RENDER}?format=pdf&invoice=INV-7&locale=it`);
  });

  it.each([
    ['empty', { _id: 'INV-7', customer_language: '' }],
    ['null', { _id: 'INV-7', customer_language: null }],
    ['missing', { _id: 'INV-7' }],
  ])('sends no language when the field is %s, so the locale of the definition prints', (_state, doc) => {
    expect(addressOf(INVOICE_LINK, doc, 'pdf')).toBe(`${RENDER}?format=pdf&invoice=INV-7`);
  });
});

describe('the address of a print link that names no language', () => {
  it('sends none, whatever the document holds', () => {
    const link: EntityReportLink = { report: 'invoice', param_map: { invoice: '_id' } };
    expect(addressOf(link, FRENCH_INVOICE, 'pdf')).toBe(`${RENDER}?format=pdf&invoice=INV-7`);
  });

  it('keeps a param named locale off csv, which the report service refuses with it', () => {
    const link: EntityReportLink = { report: 'invoice', param_map: { invoice: '_id', locale: 'customer_language' } };
    expect(addressOf(link, FRENCH_INVOICE, 'pdf')).toBe(`${RENDER}?format=pdf&invoice=INV-7&locale=fr`);
    expect(addressOf(link, FRENCH_INVOICE, 'csv')).toBe(`${RENDER}?format=csv&invoice=INV-7`);
  });
});

describe('the print preview of the invoice of a French-speaking customer', () => {
  let windowOpen: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('previews, prints and downloads in French, and downloads csv without a language', async () => {
    const user = userEvent.setup();
    const meta = {
      name: 'Invoice',
      label: 'Invoice',
      fields: [],
      reports: [INVOICE_LINK],
      permissions: [{ role: 'Clerk', level: 0, read: 1, print: 1 }],
    } as unknown as EntityDefinition;
    render(<PrintMenu meta={meta} doc={FRENCH_INVOICE} />);

    await user.click(screen.getByRole('button', { name: 'Invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invoice' });

    expect(within(dialog).getByTestId('report-preview:iframe')).toHaveAttribute('src', `${RENDER}?format=html&invoice=INV-7&locale=fr`);
    await user.click(within(dialog).getByTestId('report-preview:print'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER}?format=html&invoice=INV-7&locale=fr&print=1`, '_blank', 'noopener');
    await user.click(within(dialog).getByTestId('report-preview:download:pdf'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER}?format=pdf&invoice=INV-7&locale=fr`, '_blank', 'noopener');
    await user.click(within(dialog).getByTestId('report-preview:download:csv'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER}?format=csv&invoice=INV-7`, '_blank', 'noopener');
  });
});
