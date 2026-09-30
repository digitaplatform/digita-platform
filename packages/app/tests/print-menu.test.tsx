// @vitest-environment jsdom
// A receptionist prints an invoice from the print menu of the form. The menu offers one entry per
// report link of the entity that the person may print and whose show_if the document meets, and the
// entry opens the preview on the address built from that document. If the menu, the entries or the
// address break, the receptionist gets a blank preview or the wrong document; the record page tests
// replace the menu with a stub, so nothing else would notice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition } from '@digitaplatform/shared';

const session = vi.hoisted(() => ({ user: null as { roles: string[] } | null }));

vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: session.user }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { PrintMenu } from '@/components/workflow/PrintMenu';
import { REPORT_URL } from '@/lib/report-link';

const RENDER_BASE = `${REPORT_URL}/api/v1/report/definitions`;

const INVOICE_LINK = {
  report: 'invoice',
  label: 'Invoice',
  param_map: { invoice: '_id' },
  show_if: 'eval:doc.docstatus == 1',
  formats: ['pdf', 'html', 'png'],
};
const DELIVERY_LINK = {
  report: 'delivery-note',
  label: 'Delivery note',
  param_map: { invoice: '_id', customer: 'customer.name' },
};

const DRAFT = { _id: 'INV-7', docstatus: 0, customer: { name: 'Acme' } };
const SUBMITTED = { ...DRAFT, docstatus: 1 };

const CLERK_MAY_PRINT = [{ role: 'Clerk', level: 0, read: 1, print: 1 }];

function buildMeta(reports: Array<Record<string, unknown>>, permissions: Array<Record<string, unknown>> = CLERK_MAY_PRINT): EntityDefinition {
  return { name: 'Invoice', label: 'Invoice', fields: [], reports, permissions } as unknown as EntityDefinition;
}

function drawMenu(meta: EntityDefinition, doc: Record<string, unknown>) {
  return render(<PrintMenu meta={meta} doc={doc} />);
}

let windowOpen: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  session.user = { roles: ['Clerk'] };
  windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a document with two report links, one hidden by show_if', () => {
  it('offers the one link as a single button, with no entry for the hidden one', () => {
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), DRAFT);

    expect(screen.getByRole('button', { name: 'Delivery note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invoice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ui.action.print' })).toBeNull();
  });

  it('opens the preview of that link on the address built from the document', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), DRAFT);

    await user.click(screen.getByRole('button', { name: 'Delivery note' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delivery note' });
    expect(within(dialog).getByTestId('report-preview:iframe')).toHaveAttribute(
      'src',
      `${RENDER_BASE}/delivery-note/render?format=html&invoice=INV-7&customer=Acme`,
    );
  });

  it('offers the print link and the format links of the preview on that address', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), DRAFT);
    await user.click(screen.getByRole('button', { name: 'Delivery note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delivery note' });

    await user.click(within(dialog).getByTestId('report-preview:print'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER_BASE}/delivery-note/render?format=html&invoice=INV-7&customer=Acme&print=1`, '_blank', 'noopener');

    expect(within(dialog).getAllByTestId(/^report-preview:download:/)).toHaveLength(1);
    await user.click(within(dialog).getByTestId('report-preview:download:pdf'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER_BASE}/delivery-note/render?format=pdf&invoice=INV-7&customer=Acme`, '_blank', 'noopener');
  });
});

describe('a document with two report links that both apply', () => {
  it('offers a print menu, and draws its entries only once it is opened', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), SUBMITTED);

    expect(screen.queryByTestId('action:print:invoice')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'ui.action.print' }));

    const entries = [screen.getByTestId('action:print:invoice'), screen.getByTestId('action:print:delivery-note')];
    expect(entries.map((entry) => entry.textContent)).toEqual(['Invoice', 'Delivery note']);
  });

  it('opens the preview of the entry that is picked and closes the menu', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), SUBMITTED);
    await user.click(screen.getByRole('button', { name: 'ui.action.print' }));

    await user.click(screen.getByTestId('action:print:invoice'));

    const dialog = await screen.findByRole('dialog', { name: 'Invoice' });
    expect(within(dialog).getByTestId('report-preview:iframe')).toHaveAttribute('src', `${RENDER_BASE}/invoice/render?format=html&invoice=INV-7`);
    expect(screen.queryByTestId('action:print:delivery-note')).toBeNull();
  });

  it('offers the formats of the link except html, which is the preview itself', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), SUBMITTED);
    await user.click(screen.getByRole('button', { name: 'ui.action.print' }));
    await user.click(screen.getByTestId('action:print:invoice'));
    const dialog = await screen.findByRole('dialog', { name: 'Invoice' });

    expect(within(dialog).getAllByTestId(/^report-preview:download:/).map((button) => button.textContent)).toEqual(['PDF', 'PNG']);
    await user.click(within(dialog).getByTestId('report-preview:download:png'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER_BASE}/invoice/render?format=png&invoice=INV-7`, '_blank', 'noopener');
  });

  it('closes the menu on a press outside it, without opening a preview', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), SUBMITTED);
    await user.click(screen.getByRole('button', { name: 'ui.action.print' }));
    expect(screen.getByTestId('action:print:invoice')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByTestId('action:print:invoice')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the form in place when the preview is closed', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([INVOICE_LINK, DELIVERY_LINK]), SUBMITTED);
    await user.click(screen.getByRole('button', { name: 'ui.action.print' }));
    await user.click(screen.getByTestId('action:print:invoice'));
    await screen.findByRole('dialog', { name: 'Invoice' });

    await user.keyboard('{Escape}');

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'ui.action.print' })).toBeInTheDocument();
  });
});

describe('the names of the entries', () => {
  it('names an entry of the menu after its report when the link has no label', async () => {
    const user = userEvent.setup();
    drawMenu(buildMeta([{ report: 'packing-slip' }, DELIVERY_LINK]), DRAFT);
    await user.click(screen.getByRole('button', { name: 'ui.action.print' }));

    expect(screen.getByTestId('action:print:packing-slip')).toHaveTextContent('packing-slip');

    await user.click(screen.getByTestId('action:print:packing-slip'));
    expect(await screen.findByRole('dialog', { name: 'packing-slip' })).toBeInTheDocument();
  });

  it('names a single button with the generic print text when the link has no label', () => {
    drawMenu(buildMeta([{ report: 'packing-slip' }]), DRAFT);
    expect(screen.getByRole('button', { name: 'ui.action.print' })).toBeInTheDocument();
  });
});

describe('who is offered the print menu', () => {
  it('offers nothing when no link applies to the document', () => {
    const { container } = drawMenu(buildMeta([INVOICE_LINK]), DRAFT);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers nothing when the entity has no report links', () => {
    const { container } = drawMenu(buildMeta([]), SUBMITTED);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers nothing while nobody is signed in', () => {
    session.user = null;
    const { container } = drawMenu(buildMeta([DELIVERY_LINK]), DRAFT);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a link to a person who may read the entity when no row models the print permission', () => {
    drawMenu(buildMeta([DELIVERY_LINK], [{ role: 'Clerk', level: 0, read: 1 }]), DRAFT);
    expect(screen.getByRole('button', { name: 'Delivery note' })).toBeInTheDocument();
  });

  it('offers nothing to a person who may not read the entity when no row models the print permission', () => {
    const { container } = drawMenu(buildMeta([DELIVERY_LINK], [{ role: 'Auditor', level: 0, read: 1 }]), DRAFT);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a link to a person whose role holds the print permission', () => {
    drawMenu(buildMeta([DELIVERY_LINK], [{ role: 'Clerk', level: 0, read: 1, print: 1 }]), DRAFT);
    expect(screen.getByRole('button', { name: 'Delivery note' })).toBeInTheDocument();
  });

  it('offers nothing to a reader once a row models the print permission and the role lacks it', () => {
    const { container } = drawMenu(
      buildMeta(
        [DELIVERY_LINK],
        [
          { role: 'Clerk', level: 0, read: 1, print: 0 },
          { role: 'Manager', level: 0, read: 1, print: 1 },
        ],
      ),
      DRAFT,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for the permission the link names in place of print', () => {
    const exportLink = { ...DELIVERY_LINK, requires_permission: 'export' };
    const { container } = drawMenu(buildMeta([exportLink], [{ role: 'Clerk', level: 0, read: 1, print: 1 }]), DRAFT);
    expect(container).toBeEmptyDOMElement();

    drawMenu(buildMeta([exportLink], [{ role: 'Clerk', level: 0, read: 1, print: 1, export: 1 }]), DRAFT);
    expect(screen.getByRole('button', { name: 'Delivery note' })).toBeInTheDocument();
  });

  it('offers every link to the administrator', () => {
    session.user = { roles: ['Administrator'] };
    drawMenu(buildMeta([DELIVERY_LINK], [{ role: 'Clerk', level: 0, read: 1, print: 0 }]), DRAFT);
    expect(screen.getByRole('button', { name: 'Delivery note' })).toBeInTheDocument();
  });
});
