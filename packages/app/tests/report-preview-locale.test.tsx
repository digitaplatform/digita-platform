// @vitest-environment jsdom
// A German clerk opens the print preview of an invoice. The preview is the kit's dialog, and the kit
// knows no language: the app names its buttons from its chrome texts, or the clerk reads "Print",
// "Reload preview", "Open in new tab" and "Close" in English. The print button of a list row whose
// link has no label is named from the same texts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';
import { readBundle } from '@digitaplatform/shared/i18n-node';
import { ReportPreviewDialog } from '@digitaplatform/components';
import { useI18nStore } from '@/stores/i18n';

vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: { roles: ['Clerk'] } }),
}));

import { PrintMenu } from '@/components/workflow/PrintMenu';
import { RowPrintButton } from '@/components/workflow/RowPrintButton';

// tests/setup.ts stops the run without it.
const texts = readBundle(process.env.TRANSLATIONS_DIR!);

function germanText(key: string): string {
  const text = texts.de![key];
  if (text === undefined) throw new Error(`the German texts of digita-app have no ${key}`);
  return text;
}

const INVOICE_LINK: EntityReportLink = { report: 'invoice', label: 'Invoice', param_map: { invoice: '_id' } };
const DOC = { _id: 'INV-7', docstatus: 1 };
const SRC = 'https://reports.example/api/v1/report/definitions/invoice/render?format=html&invoice=INV-7';

function buildMeta(reports: EntityReportLink[]): EntityDefinition {
  return {
    name: 'Invoice',
    label: 'Invoice',
    fields: [],
    reports,
    permissions: [{ role: 'Clerk', level: 0, read: 1, print: 1 }],
  } as unknown as EntityDefinition;
}

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
  useI18nStore.setState({ locale: 'de', translations: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  useI18nStore.setState({ locale: 'en', translations: {} });
});

describe('the print preview of a record, in German', () => {
  it('names its print, reload, open and close buttons in German', async () => {
    const user = userEvent.setup();
    render(<PrintMenu meta={buildMeta([INVOICE_LINK])} doc={DOC} />);

    await user.click(screen.getByRole('button', { name: 'Invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invoice' });

    expect(within(dialog).getByTestId('report-preview:print')).toHaveTextContent(germanText('ui.action.print'));
    expect(within(dialog).getByTestId('report-preview:reload')).toHaveAccessibleName(germanText('ui.report.reloadPreview'));
    expect(within(dialog).getByTestId('report-preview:open')).toHaveAccessibleName(germanText('ui.report.openInNewTab'));
    expect(within(dialog).getByRole('button', { name: germanText('ui.action.close') })).toBeInTheDocument();
  });
});

describe('the print button of a list row, in German', () => {
  it('is named by the German print text when its link has no label', () => {
    render(<RowPrintButton link={{ report: 'invoice' }} doc={DOC} onPrint={() => {}} />);

    expect(screen.getByRole('button', { name: germanText('ui.action.print') })).toBeInTheDocument();
  });
});

describe('ReportPreviewDialog', () => {
  it('names its buttons as its caller asks', () => {
    render(
      <ReportPreviewDialog
        open
        onClose={() => {}}
        title="Rechnung"
        src={SRC}
        printHref={`${SRC}&print=1`}
        printLabel="Drucken"
        reloadLabel="Vorschau neu laden"
        openLabel="In neuem Tab öffnen"
        closeLabel="Schließen"
      />,
    );

    expect(screen.getByTestId('report-preview:print')).toHaveTextContent('Drucken');
    expect(screen.getByTestId('report-preview:reload')).toHaveAccessibleName('Vorschau neu laden');
    expect(screen.getByTestId('report-preview:open')).toHaveAccessibleName('In neuem Tab öffnen');
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeInTheDocument();
  });

  it('keeps its English names for a caller that passes none', () => {
    render(<ReportPreviewDialog open onClose={() => {}} title="Invoice" src={SRC} printHref={`${SRC}&print=1`} />);

    expect(screen.getByTestId('report-preview:print')).toHaveTextContent('Print');
    expect(screen.getByTestId('report-preview:reload')).toHaveAccessibleName('Reload preview');
    expect(screen.getByTestId('report-preview:open')).toHaveAccessibleName('Open in new tab');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
