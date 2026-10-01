// @vitest-environment jsdom
// A tree entity's list in tree display searches in the tree's own box only: the header's box would
// write ?q=, which the tree never reads, so a person typing there would see nothing filter. Moving to
// tree display drops a query typed in list display, which the tree box would not show while the
// count and the exports still carried it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

const state = vi.hoisted(() => ({ params: new URLSearchParams(), setParams: vi.fn() }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'CustomerGroup' }),
  useSearchParams: () => [state.params, state.setParams],
  useNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({
    data: {
      name: 'CustomerGroup',
      label: 'Customer group',
      title_field: 'name',
      tree: { parent_field: 'parent', label_field: 'name' },
      fields: [
        { fieldname: 'name', fieldtype: 'Data', label: 'Name' },
        { fieldname: 'region', fieldtype: 'Data', label: 'Region' },
      ],
      permissions: [{ role: 'Clerk', level: 0, select: 1, read: 1 }],
    } as unknown as EntityDefinition,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/useList', () => ({
  useList: () => ({ data: undefined, isLoading: true, isError: false, isFetching: false }),
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
vi.mock('@/components/render/TreeEditor', () => ({ TreeEditor: () => <div data-testid="tree-editor" /> }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));
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

function renderList(params: Record<string, string>) {
  state.params = new URLSearchParams(params);
  state.setParams.mockReset();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ListPage />
    </QueryClientProvider>,
  );
}

/** The URL parameters of the last write, as a plain object. */
const lastWrite = () => Object.fromEntries(state.setParams.mock.lastCall![0] as URLSearchParams);

afterEach(cleanup);

describe('ListPage search of a tree entity', () => {
  it('shows no header search box in tree display', () => {
    renderList({ display: 'tree' });
    expect(screen.getByTestId('tree-editor')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'ui.list.search' })).toBeNull();
  });

  it('keeps the header search box in list display', () => {
    renderList({});
    expect(screen.getByRole('searchbox', { name: 'ui.list.search' })).toBeInTheDocument();
  });

  it('drops the list query when the display moves to the tree and keeps the filters', () => {
    const f = JSON.stringify([['region', '=', 'North']]);
    renderList({ q: 'rose', f });
    fireEvent.click(screen.getByRole('radio', { name: 'ui.tree.viewTree' }));
    expect(lastWrite()).toEqual({ display: 'tree', f });
  });

  it('keeps the filters when the display moves back to the list', () => {
    const f = JSON.stringify([['region', '=', 'North']]);
    renderList({ display: 'tree', f });
    fireEvent.click(screen.getByRole('radio', { name: 'ui.tree.viewList' }));
    expect(lastWrite()).toEqual({ f });
  });
});
