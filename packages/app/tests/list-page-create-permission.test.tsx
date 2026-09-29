// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The list offers New only where the engine grants `create`: through a level-0 row
 * of one of the user's roles. A row at a higher level opens the fields of that
 * `perm_level` and grants no action, so a `create` bit there must not show New.
 */

const state = vi.hoisted(() => ({ meta: {} as EntityDefinition }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Book' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
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
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: string }) => unknown) =>
    sel({ user: { roles: ['Librarian'] }, locale: 'en' }),
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

function renderList(permissions: EntityPermission[]) {
  state.meta = {
    name: 'Book',
    label: 'Book',
    title_field: 'title',
    fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
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

describe('ListPage New button follows the engine create grant', () => {
  it('shows no New for a create bit on a level-1 row only', () => {
    const { queryAllByRole } = renderList([
      { role: 'Librarian', level: 0, select: 1, read: 1 },
      { role: 'Librarian', level: 1, read: 1, write: 1, create: 1 },
    ]);
    expect(queryAllByRole('button', { name: 'ui.action.new' })).toHaveLength(0);
  });

  it('shows New for a create bit on a level-0 row', () => {
    const { queryAllByRole } = renderList([
      { role: 'Librarian', level: 0, select: 1, read: 1, create: 1 },
    ]);
    expect(queryAllByRole('button', { name: 'ui.action.new' }).length).toBeGreaterThan(0);
  });
});
