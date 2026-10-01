// @vitest-environment jsdom
// A record page speaks the session language in its links: an entry carries the app's text for its
// link, the way a field label does, and draws the icon the entity file names for it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { EntityDefinition, LinkDefinition } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';

const state = vi.hoisted(() => ({
  links: [] as LinkDefinition[],
  readable: ['Sale', 'Invoice', 'Payment'],
  related: [] as Array<{ label: string; entity: string; count: number }>,
}));

// The meta service answers the raw entity file; the page localizes it through useMeta.
vi.mock('@/services/meta', () => ({
  getEntityMeta: async () => ({
    success: true,
    status_code: 200,
    messages: [],
    data: {
      name: 'Sale',
      label: 'Sale',
      label_plural: 'Sales',
      is_submittable: true,
      fields: [{ fieldname: 'customer', fieldtype: 'Data', label: 'Customer' }],
      permissions: [],
      links: state.links,
    } as unknown as EntityDefinition,
  }),
  getEntityCatalog: async () => ({
    success: true,
    status_code: 200,
    messages: [],
    data: state.readable.map((name) => ({ name, module: 'm', database: 'd', label: name })),
  }),
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
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Reception'] } }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

const INVOICES: LinkDefinition = { label: 'Invoices', entity: 'Invoice', link_field: 'sale', show_count: true };
const PAYMENTS: LinkDefinition = { label: 'Payments', entity: 'Payment', link_field: 'sale' };

beforeEach(() => {
  state.links = [];
  state.related = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/api/v1/resource/Sale/S-2026-00002/related')
        ? new Response(JSON.stringify({ success: true, status_code: 200, data: state.related, messages: [] }), {
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 404 }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderSale(translations: Record<string, string>) {
  useI18nStore.setState({ locale: 'de', translations, loaded: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/:entity/:name', element: <RecordPage /> }], {
    initialEntries: ['/Sale/S-2026-00002'],
  });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('the links of a German record page', () => {
  it('name an entry by the German text of its link and keep the written label where there is none', async () => {
    state.links = [INVOICES, PAYMENTS];
    state.related = [
      { label: 'Invoices', entity: 'Invoice', count: 1 },
      { label: 'Payments', entity: 'Payment', count: 0 },
    ];
    renderSale({ 'link.Sale.Invoice.sale': 'Rechnungen' });

    expect(await screen.findByRole('link', { name: 'Rechnungen 1' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Invoices/ })).not.toBeInTheDocument();
  });

  it('draw the icon of a link that names a known one, and no icon for any other', async () => {
    state.links = [
      { ...INVOICES, icon: 'file' },
      { ...PAYMENTS, icon: 'no-such-icon' },
      { label: 'Returns', entity: 'Invoice', link_field: 'return_of' },
    ];
    state.related = [
      { label: 'Invoices', entity: 'Invoice', count: 1 },
      { label: 'Payments', entity: 'Payment', count: 0 },
      { label: 'Returns', entity: 'Invoice', count: 0 },
    ];
    renderSale({});

    const withIcon = await screen.findByRole('link', { name: 'Invoices 1' }, { timeout: 3000 });
    expect(withIcon.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: 'Payments' }).querySelector('svg')).toBeNull();
    expect(screen.getByRole('link', { name: 'Returns' }).querySelector('svg')).toBeNull();
  });
});
