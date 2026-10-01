// @vitest-environment jsdom
// An app author links a report that reads an invoice's lines and its payments, two collections, and
// offers csv. The report service answers a csv export of such a report with 400 unless `source` names
// the collection to export, so the link names it and the csv download sends it. The other formats
// render the whole report and send no source.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';

vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: { roles: ['Clerk'] } }),
}));

import { PrintMenu } from '@/components/workflow/PrintMenu';
import { REPORT_URL, reportRenderUrl } from '@/lib/report-link';

const RENDER = `${REPORT_URL}/api/v1/report/definitions/invoice/render`;
const PARAMS = { invoice: 'INV-7' };

describe('the address of a report render with a source', () => {
  it('names the source on a csv export', () => {
    expect(reportRenderUrl('invoice', PARAMS, 'csv', { source: 'lines' })).toBe(`${RENDER}?format=csv&invoice=INV-7&source=lines`);
  });

  it.each(['html', 'pdf', 'png'] as const)('names no source on %s, which renders the whole report', (format) => {
    expect(reportRenderUrl('invoice', PARAMS, format, { source: 'lines' })).toBe(`${RENDER}?format=${format}&invoice=INV-7`);
  });

  it('names no source on a csv export of a link that names none', () => {
    expect(reportRenderUrl('invoice', PARAMS, 'csv')).toBe(`${RENDER}?format=csv&invoice=INV-7`);
  });
});

describe('the csv download of a report link that names its source', () => {
  let windowOpen: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the source with csv only', async () => {
    const user = userEvent.setup();
    const link: EntityReportLink = {
      report: 'invoice',
      label: 'Invoice',
      param_map: { invoice: '_id' },
      formats: ['pdf', 'csv'],
      source: 'lines',
    };
    const meta = {
      name: 'Invoice',
      label: 'Invoice',
      fields: [],
      reports: [link],
      permissions: [{ role: 'Clerk', level: 0, read: 1, print: 1 }],
    } as unknown as EntityDefinition;
    render(<PrintMenu meta={meta} doc={{ _id: 'INV-7' }} />);

    await user.click(screen.getByRole('button', { name: 'Invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invoice' });

    expect(within(dialog).getByTestId('report-preview:iframe')).toHaveAttribute('src', `${RENDER}?format=html&invoice=INV-7`);
    await user.click(within(dialog).getByTestId('report-preview:download:csv'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER}?format=csv&invoice=INV-7&source=lines`, '_blank', 'noopener');
    await user.click(within(dialog).getByTestId('report-preview:download:pdf'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER}?format=pdf&invoice=INV-7`, '_blank', 'noopener');
  });
});
