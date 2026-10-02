// @vitest-environment jsdom
// The record page shows the entity's `links`: each entry with its label and, where `show_count`
// is set, the count `GET /resource/<entity>/<id>/related` answers. An entry opens the list of the
// linked entity filtered to the rows that point at the record.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useParams, useSearchParams } from 'react-router-dom';
import type { EntityDefinition, LinkDefinition } from '@digitaplatform/shared';
import { parseFilterTuplesParam } from '@/lib/filter-from-url';

const state = vi.hoisted(() => ({
  links: undefined as LinkDefinition[] | undefined,
  readable: [] as string[],
  related: { status: 200, body: {} as unknown },
  requests: [] as string[],
}));

vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({
    data: {
      name: 'Sale',
      label: 'Sale',
      label_plural: 'Sales',
      is_submittable: true,
      fields: [{ fieldname: 'customer', fieldtype: 'Data', label: 'Customer' }],
      permissions: [],
      links: state.links,
    } as unknown as EntityDefinition,
    isLoading: false,
    isError: false,
  }),
  useMetaCatalog: () => ({ data: state.readable.map((name) => ({ name, module: 'm', database: 'd' })) }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({
    data: { _id: 'S-2026-00002', modified: 'T1', docstatus: 1, customer: 'C-1' },
    isLoading: false,
    isError: false,
  }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/components/render/FormRenderer', () => ({ FormRenderer: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Reception'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, _f: string, fb?: string) => fb,
      tOption: (_e: string, _f: string, v: string) => v,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

/** Stands in for the list page: shows the entity and the filter the list would read from `?f`. */
function ListProbe() {
  const { entity } = useParams();
  const [sp] = useSearchParams();
  return <output data-testid="list-probe">{`${entity} ${JSON.stringify(parseFilterTuplesParam(sp.get('f')))}`}</output>;
}

function renderSale() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/:entity/:name', element: <RecordPage /> },
      { path: '/:entity', element: <ListProbe /> },
    ],
    { initialEntries: ['/Sale/S-2026-00002'] },
  );
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const INVOICES: LinkDefinition = { label: 'Invoices', entity: 'Invoice', link_field: 'sale', show_count: true };
const PAYMENTS: LinkDefinition = { label: 'Payments', entity: 'Payment', link_field: 'sale' };

beforeEach(() => {
  state.links = undefined;
  state.readable = ['Sale', 'Invoice', 'Payment'];
  state.requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      state.requests.push(url);
      if (url.endsWith('/api/v1/resource/Sale/S-2026-00002/related')) {
        return new Response(JSON.stringify(state.related.body), {
          status: state.related.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function answerRelated(entries: Array<{ label: string; entity: string; count?: number; error?: string }>) {
  state.related = { status: 200, body: { success: true, status_code: 200, data: entries, messages: [] } };
}

describe('RecordPage links', () => {
  it('shows a submitted Invoice that links to the Sale and opens the Invoice list of that Sale', async () => {
    state.links = [INVOICES];
    answerRelated([{ label: 'Invoices', entity: 'Invoice', count: 1 }]);
    renderSale();

    const entry = await screen.findByRole('link', { name: 'Invoices 1' });
    await userEvent.click(entry);

    expect(await screen.findByTestId('list-probe')).toHaveTextContent('Invoice [["sale","=","S-2026-00002"]]');
  });

  it('shows no count for a link without show_count', async () => {
    state.links = [INVOICES, PAYMENTS];
    // The route answers one entry per declared link, in declaration order.
    answerRelated([
      { label: 'Invoices', entity: 'Invoice', count: 1 },
      { label: 'Payments', entity: 'Payment', count: 0 },
    ]);
    renderSale();

    await screen.findByRole('link', { name: 'Invoices 1' });
    expect(screen.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
  });

  it('gives two links of the same entity and label their own counts, by declaration order', async () => {
    state.links = [INVOICES, { ...INVOICES, link_field: 'return_of' }];
    answerRelated([
      { label: 'Invoices', entity: 'Invoice', count: 3 },
      { label: 'Invoices', entity: 'Invoice', count: 1 },
    ]);
    renderSale();

    expect(await screen.findByRole('link', { name: 'Invoices 3' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Invoices 1' })).toBeInTheDocument();
  });

  it('shows no entry for a linked entity the caller may not read', async () => {
    state.links = [INVOICES, PAYMENTS];
    state.readable = ['Sale', 'Payment'];
    // The route counts 0 for an entity the caller may not select.
    answerRelated([
      { label: 'Invoices', entity: 'Invoice', count: 0 },
      { label: 'Payments', entity: 'Payment', count: 0 },
    ]);
    renderSale();

    await screen.findByRole('link', { name: 'Payments' });
    expect(screen.queryByRole('link', { name: /Invoices/ })).not.toBeInTheDocument();
  });

  it('keeps every entry when the related route refuses one link, and shows no count it did not get', async () => {
    state.links = [INVOICES, PAYMENTS];
    state.related = {
      status: 400,
      body: {
        success: false,
        status_code: 400,
        data: null,
        messages: [{ text: 'filter_field_not_allowed', type: 'error' }],
        error: { code: 'FILTER_FIELD_NOT_ALLOWED', detail: 'Filter field not allowed: sale' },
      },
    };
    renderSale();

    const invoices = await screen.findByRole('link', { name: 'Invoices —' });
    await waitFor(() => expect(within(invoices).getByText('—')).toHaveAttribute('title', 'filter_field_not_allowed'));
    expect(screen.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
  });

  it("shows a link's own refusal on its badge and the other link's count", async () => {
    const RETURNS: LinkDefinition = { label: 'Returns', entity: 'Invoice', link_field: 'return_of', show_count: true };
    state.links = [INVOICES, RETURNS];
    answerRelated([
      { label: 'Invoices', entity: 'Invoice', error: 'The list of Invoice matches more than 5000 rows' },
      { label: 'Returns', entity: 'Invoice', count: 2 },
    ]);
    renderSale();

    const invoices = await screen.findByRole('link', { name: 'Invoices —' });
    expect(within(invoices).getByText('—')).toHaveAttribute('title', 'The list of Invoice matches more than 5000 rows');
    expect(await screen.findByRole('link', { name: 'Returns 2' })).toBeInTheDocument();
  });

  it("shows no refusal an answer for another entity carries", async () => {
    state.links = [INVOICES];
    answerRelated([{ label: 'Payments', entity: 'Payment', error: 'The list of Payment matches more than 5000 rows' }]);
    renderSale();

    const invoices = await screen.findByRole('link', { name: 'Invoices —' });
    await waitFor(() => expect(within(invoices).getByText('—')).not.toHaveAttribute('title', 'The list of Payment matches more than 5000 rows'));
  });

  it('shows no links and asks no count for an entity without links', async () => {
    renderSale();

    await screen.findByTestId('page:record:Sale');
    expect(screen.queryByTestId('record-links')).not.toBeInTheDocument();
    expect(state.requests.filter((u) => u.includes('/related'))).toEqual([]);
  });
});
