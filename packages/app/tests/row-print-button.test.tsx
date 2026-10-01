// @vitest-environment jsdom
// A receptionist prints an invoice from the print button at the end of a row in a list and sees its
// preview. The button is offered per row by the show_if of the link, and the list opens one preview
// dialog for the row whose button was clicked. If the button, the dialog or the address it builds
// break, the receptionist gets a blank preview or the document of another row.
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityReportLink } from '@digitaplatform/shared';

// The list's grid virtualizes its rows, which needs a measurable layout that jsdom does not have.
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 1000, height: 480, top: 0, left: 0, right: 1000, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return RECT;
  };
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: RECT,
            borderBoxSize: [{ inlineSize: 1000, blockSize: 480 }],
            contentBoxSize: [{ inlineSize: 1000, blockSize: 480 }],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

const state = vi.hoisted(() => ({
  meta: {} as unknown,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Invoice' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useList', () => ({
  useList: () => ({
    data: { rows: state.rows, page: 1, total: state.rows.length, totalPages: 1 },
    isLoading: false,
    isError: false,
    isFetching: false,
  }),
}));
vi.mock('@/hooks/useListPreferences', () => ({
  useListPreferences: () => ({ views: [], defaultView: undefined, isLoading: false, isAdmin: false, canEdit: () => false }),
}));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ user: { roles: ['Clerk'] }, locale: { format_locale: 'en-GB' } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({
      translations: {},
      t: (key: string) => key,
      tField: (_entity: string, _field: string, fallback?: string) => fallback ?? '',
      tOption: (_entity: string, _field: string, value: string) => value,
      tEntity: (entity: string, fallback?: string) => fallback ?? entity,
    }),
}));

import ListPage from '@/pages/ListPage';
import { RowPrintButton } from '@/components/workflow/RowPrintButton';
import { REPORT_URL } from '@/lib/report-link';

const RENDER_BASE = `${REPORT_URL}/api/v1/report/definitions`;

const INVOICE_LINK: EntityReportLink = {
  report: 'invoice',
  label: 'Print invoice',
  param_map: { invoice: '_id' },
  show_if: 'eval:doc.docstatus == 1',
};
const DELIVERY_LINK: EntityReportLink = { report: 'delivery-note', label: 'Print delivery note', param_map: { invoice: '_id' } };

const CLERK_MAY_PRINT = [{ role: 'Clerk', level: 0, read: 1, print: 1 }];

function drawList(reports: EntityReportLink[], permissions: Array<Record<string, unknown>> = CLERK_MAY_PRINT) {
  state.meta = {
    name: 'Invoice',
    label: 'Invoice',
    title_field: 'title',
    fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
    reports,
    permissions,
  } as unknown as EntityDefinition;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ListPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.rows = [
    { _id: 'INV-1', title: 'First invoice', docstatus: 0 },
    { _id: 'INV-2', title: 'Second invoice', docstatus: 1 },
    { _id: 'INV-3', title: 'Third invoice', docstatus: 1 },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RowPrintButton', () => {
  it('is an icon button named by the label of its link, and by Print when the link has none', () => {
    const { rerender } = render(<RowPrintButton link={INVOICE_LINK} doc={{ docstatus: 1 }} onPrint={() => {}} />);
    expect(screen.getByRole('button', { name: 'Print invoice' })).toBeInTheDocument();

    rerender(<RowPrintButton link={{ report: 'invoice' }} doc={{}} onPrint={() => {}} />);
    expect(screen.getByRole('button', { name: 'ui.action.print' })).toBeInTheDocument();
  });

  it('hands its row to onPrint without reaching the row it sits in', async () => {
    const user = userEvent.setup();
    const onPrint = vi.fn();
    const onRowClick = vi.fn();
    const doc = { _id: 'INV-2', docstatus: 1 };
    render(
      <div onClick={onRowClick}>
        <RowPrintButton link={INVOICE_LINK} doc={doc} onPrint={onPrint} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Print invoice' }));

    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onPrint).toHaveBeenCalledWith(doc);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('draws nothing for a row that the show_if of its link rules out', () => {
    const { container } = render(<RowPrintButton link={INVOICE_LINK} doc={{ docstatus: 0 }} onPrint={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the print button of a row in a list', () => {
  it('is drawn on the rows the show_if of the link applies to, and on no other', async () => {
    drawList([INVOICE_LINK]);

    const buttons = await screen.findAllByRole('button', { name: 'Print invoice' });

    expect(buttons).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the preview of the row whose button is clicked', async () => {
    const user = userEvent.setup();
    drawList([INVOICE_LINK]);
    const [second, third] = await screen.findAllByRole('button', { name: 'Print invoice' });

    await user.click(third!);

    const dialog = await screen.findByRole('dialog', { name: 'Print invoice' });
    expect(within(dialog).getByTestId('report-preview:iframe')).toHaveAttribute('src', `${RENDER_BASE}/invoice/render?format=html&invoice=INV-3`);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(second!);

    const again = await screen.findByRole('dialog', { name: 'Print invoice' });
    expect(within(again).getByTestId('report-preview:iframe')).toHaveAttribute('src', `${RENDER_BASE}/invoice/render?format=html&invoice=INV-2`);
  });

  it('offers the print link and the PDF link of that row in the preview', async () => {
    const user = userEvent.setup();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    drawList([INVOICE_LINK]);
    const [second] = await screen.findAllByRole('button', { name: 'Print invoice' });

    await user.click(second!);
    const dialog = await screen.findByRole('dialog', { name: 'Print invoice' });

    await user.click(within(dialog).getByTestId('report-preview:print'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER_BASE}/invoice/render?format=html&invoice=INV-2&print=1`, '_blank', 'noopener');
    await user.click(within(dialog).getByTestId('report-preview:download:pdf'));
    expect(windowOpen).toHaveBeenLastCalledWith(`${RENDER_BASE}/invoice/render?format=pdf&invoice=INV-2`, '_blank', 'noopener');
  });

  it('prints with the primary link of the entity', async () => {
    drawList([DELIVERY_LINK, { ...INVOICE_LINK, primary: true, show_if: undefined }]);

    const buttons = await screen.findAllByRole('button', { name: 'Print invoice' });

    expect(buttons).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Print delivery note' })).toBeNull();
  });

  it('prints with the first permitted link when none is primary', async () => {
    drawList([DELIVERY_LINK, INVOICE_LINK]);

    const buttons = await screen.findAllByRole('button', { name: 'Print delivery note' });

    expect(buttons).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Print invoice' })).toBeNull();
  });

  it('is left out of the list for a person who may not print', async () => {
    drawList([DELIVERY_LINK], [{ role: 'Clerk', level: 0, read: 1, print: 0 }]);

    await screen.findByTestId('row:INV-1');

    expect(screen.queryByRole('button', { name: 'Print delivery note' })).toBeNull();
  });

  it('is left out of the list for an entity that has no report link', async () => {
    drawList([]);

    await screen.findByTestId('row:INV-1');

    expect(screen.queryByRole('button', { name: /^Print/ })).toBeNull();
  });
});
