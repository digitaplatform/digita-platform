// @vitest-environment jsdom
// The list of a tree entity has one search box in either display. The tree reads its own box, never
// the list's `?q=`, so the header's box would filter nothing in the tree display. Moving to the tree
// drops a query typed in list display, which no box would show while the count and the exports
// still carried it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

const page = vi.hoisted(() => ({ search: '', setParams: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'CustomerGroup' }),
  useSearchParams: () => [new URLSearchParams(page.search), page.setParams],
  useNavigate: () => vi.fn(),
}));
const META = vi.hoisted(
  () =>
    ({
      name: 'CustomerGroup',
      label: 'Customer group',
      title_field: 'name',
      fields: [
        { fieldname: 'name', fieldtype: 'Data', label: 'Name' },
        { fieldname: 'parent', fieldtype: 'Link', label: 'Parent', target: 'CustomerGroup' },
      ],
      tree: {},
      permissions: [{ role: 'Clerk', level: 0, select: 1, read: 1 }],
    }) as unknown as EntityDefinition,
);
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
const ROWS = [
  { _id: 'G-1', label: 'Retail', parent: null },
  { _id: 'G-2', label: 'Swiss', parent: 'G-1' },
  { _id: 'G-3', label: 'Wholesale', parent: null },
];
vi.mock('@/hooks/useList', () => ({
  useList: () => ({
    data: { rows: ROWS, total: ROWS.length, page: 1, pageSize: 20, totalPages: 1 },
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
vi.mock('@/components/record/RecordDialog', () => ({ RecordDialog: () => null }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: string }) => unknown) =>
    sel({ user: { roles: ['Clerk'] }, locale: 'en' }),
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
import { useUiStore } from '@/stores/ui';

function renderList(search: string) {
  page.search = search;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ListPage />
    </QueryClientProvider>,
  );
}

/** The URL parameters of the last write, as a plain object. */
const lastWrite = () => Object.fromEntries(page.setParams.mock.lastCall![0] as URLSearchParams);

const listSearchBoxes = () => screen.queryAllByRole('searchbox', { name: 'ui.list.search' });

beforeEach(() => useUiStore.setState({ treeEditorCollapsedIds: {} }));

describe('ListPage search of a tree entity', () => {
  it('shows one search box in the tree display, and it filters the tree', async () => {
    renderList('display=tree');
    expect(listSearchBoxes()).toHaveLength(1);
    await userEvent.setup().type(listSearchBoxes()[0]!, 'swi');
    expect(screen.getByText('Swiss')).toBeInTheDocument();
    expect(document.querySelector('[data-tree-id="G-3"]')).toBeNull();
  });

  it('keeps the search box of the list display', () => {
    renderList('');
    expect(listSearchBoxes()).toHaveLength(1);
  });

  it('drops the list query when the display moves to the tree and keeps the filters', () => {
    const f = JSON.stringify([['region', '=', 'North']]);
    renderList(new URLSearchParams({ q: 'rose', f }).toString());
    fireEvent.click(screen.getByRole('radio', { name: 'ui.tree.viewTree' }));
    expect(lastWrite()).toEqual({ display: 'tree', f });
  });

  it('keeps the filters when the display moves back to the list', () => {
    const f = JSON.stringify([['region', '=', 'North']]);
    renderList(new URLSearchParams({ display: 'tree', f }).toString());
    fireEvent.click(screen.getByRole('radio', { name: 'ui.tree.viewList' }));
    expect(lastWrite()).toEqual({ f });
  });
});
