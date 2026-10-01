// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The engine leaves a field out of every row of a list when no read row of the user's roles
 * opens it. The list leaves such a column out instead of showing it empty on every row; a
 * user who reads the field's level still sees the column, and so does a level-0 field where
 * the list can hold rows shared with the user.
 */

const state = vi.hoisted(() => ({
  meta: {} as EntityDefinition,
  rows: [] as Record<string, unknown>[],
  roles: [] as string[],
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Part' }),
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
  useListPreferences: () => ({
    views: [],
    defaultView: undefined,
    isLoading: false,
    isAdmin: false,
    canEdit: () => false,
  }),
}));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: string }) => unknown) =>
    sel({ user: { roles: state.roles }, locale: 'en' }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tField: (_e: string, _f: string, fb?: string) => fb ?? '',
      tOption: (_e: string, _f: string, v: string) => v,
      tEntity: (e: string, fb?: string) => fb ?? e,
    }),
}));

import ListPage from '@/pages/ListPage';

const PERMISSIONS: EntityPermission[] = [
  { role: 'Reception', level: 0, select: 1, read: 1 },
  { role: 'Lead', level: 0, select: 1, read: 1 },
  { role: 'Lead', level: 1, read: 1 },
];

function renderParts(roles: string[], rows: Record<string, unknown>[], permissions = PERMISSIONS) {
  state.roles = roles;
  state.rows = rows;
  state.meta = {
    name: 'Part',
    label: 'Part',
    title_field: 'part_name',
    fields: [
      { fieldname: 'part_name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'stock', fieldtype: 'Int', label: 'Stock', in_list_view: true },
      { fieldname: 'purchase_price', fieldtype: 'Currency', label: 'Purchase price', in_list_view: true, perm_level: 1 },
    ],
    permissions,
  } as unknown as EntityDefinition;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ListPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('ListPage and the fields a user may not read', () => {
  it('leaves out the column of a level-1 field for a level-0 reader', () => {
    renderParts(['Reception'], [{ _id: 'P-1', part_name: 'Brake pad', stock: 4 }]);
    expect(screen.getByRole('columnheader', { name: /Stock/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Purchase price/ })).toBeNull();
  });

  it('shows the column of a level-1 field to a reader of level 1', () => {
    renderParts(['Lead'], [{ _id: 'P-1', part_name: 'Brake pad', stock: 4, purchase_price: 549.86 }]);
    expect(screen.getByRole('columnheader', { name: /Purchase price/ })).toBeInTheDocument();
  });

  // The engine lists the rows shared with the user and shows what a level-0 read shows on them.
  it('shows the level-0 columns to a user who may select but not read, for the rows shared with them', () => {
    renderParts(['Guest'], [{ _id: 'P-1', part_name: 'Brake pad', stock: 4 }], [{ role: 'Guest', level: 0, select: 1 }]);
    expect(screen.getByRole('columnheader', { name: /Stock/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Purchase price/ })).toBeNull();
  });

  // A conditional read row makes the engine re-check every row's read, which drops the shared rows.
  it('leaves out a level-0 column no read row opens where a conditional read row keeps shared rows out', () => {
    renderParts(
      ['Guest'],
      [{ _id: 'P-1', part_name: 'Brake pad' }],
      [{ role: 'Guest', level: 0, select: 1, read: 1, condition: "doc.stock > 0", fields: ['part_name'] }],
    );
    expect(screen.queryByRole('columnheader', { name: /Stock/ })).toBeNull();
  });
});
