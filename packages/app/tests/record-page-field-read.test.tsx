// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The engine leaves out of a record every field the user may not read: a field at a
 * `perm_level` no read row of the user's roles opens. The record page leaves such a field out
 * of the form, and such a child field out of the grid, instead of drawing an empty control
 * that reads as "no value was entered". A user who reads the level still sees the value.
 */

const state = vi.hoisted(() => ({
  meta: {} as EntityDefinition,
  loaded: {} as Record<string, unknown>,
  roles: [] as string[],
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Part', name: 'P-1' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: state.loaded, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { _id: 'u1', email: 'rita@example.com', roles: state.roles } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, _f: string, fb?: string) => fb ?? '',
      tOption: (_e: string, _f: string, v: string) => v,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

const PERMISSIONS: EntityPermission[] = [
  { role: 'Reception', level: 0, read: 1, write: 1 },
  { role: 'Lead', level: 0, read: 1, write: 1 },
  { role: 'Lead', level: 1, read: 1, write: 1 },
];

function renderPart(roles: string[], part: Record<string, unknown>) {
  state.roles = roles;
  state.meta = {
    name: 'Part',
    label: 'Part',
    title_field: '_id',
    fields: [
      { fieldname: 'part_name', fieldtype: 'Data', label: 'Name' },
      { fieldname: 'purchase_price', fieldtype: 'Currency', label: 'Purchase price', perm_level: 1 },
      {
        fieldname: 'suppliers',
        fieldtype: 'Table',
        label: 'Suppliers',
        child_fields: [
          { fieldname: 'supplier', fieldtype: 'Data', label: 'Supplier', in_list_view: true },
          { fieldname: 'price', fieldtype: 'Currency', label: 'Price', in_list_view: true, perm_level: 1 },
        ],
      },
    ],
    permissions: PERMISSIONS,
  } as unknown as EntityDefinition;
  state.loaded = { _id: 'P-1', modified: 'T1', docstatus: 0, part_name: 'Brake pad', ...part };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('RecordPage and the fields a user may not read', () => {
  it('leaves a level-1 field out of the form, and a level-1 child out of the grid, for a level-0 reader', async () => {
    // The engine sent the record without the level-1 values.
    renderPart(['Reception'], { suppliers: [{ _row_id: 'r1', supplier: 'Acme' }] });

    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('Brake pad');
    expect(screen.queryByText('Purchase price')).toBeNull();
    const grid = await screen.findByRole('grid', { name: 'Suppliers' });
    expect(within(grid).getByRole('columnheader', { name: /Supplier/ })).toBeInTheDocument();
    expect(within(grid).queryByRole('columnheader', { name: /Price/ })).toBeNull();
  });

  it('draws the level-1 field with its value, and the level-1 child, for a reader of level 1', async () => {
    renderPart(['Lead'], { purchase_price: 549.86, suppliers: [{ _row_id: 'r1', supplier: 'Acme', price: 12.5 }] });

    expect(await screen.findByRole('spinbutton', { name: 'Purchase price' })).toHaveValue(549.86);
    const grid = await screen.findByRole('grid', { name: 'Suppliers' });
    expect(within(grid).getByRole('columnheader', { name: /Price/ })).toBeInTheDocument();
  });
});
