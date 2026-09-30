// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The engine answers an export for re-import only for a user who holds the `export` bit through
 * a level-0 row; reading the entity is not enough, whether or not any row models `export`. The
 * list offers Data > Export for re-import by the same rule.
 */

const state = vi.hoisted(() => ({ meta: {} as EntityDefinition, roles: [] as string[] }));

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

function openDataMenu(roles: string[], permissions: EntityPermission[]) {
  state.roles = roles;
  state.meta = {
    name: 'Book',
    label: 'Book',
    title_field: 'title',
    fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
    permissions,
  } as unknown as EntityDefinition;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ListPage />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'ui.list.dataMenu' }));
}

afterEach(cleanup);

describe('ListPage offers Export for re-import by the engine export rule', () => {
  it('offers no Export for re-import to a reader of an entity where no row models export', () => {
    openDataMenu(['Librarian'], [{ role: 'Librarian', level: 0, select: 1, read: 1 }]);
    expect(screen.getByText('ui.list.export')).toBeInTheDocument();
    expect(screen.queryByText('ui.list.exportRoundTrip')).toBeNull();
  });

  it('offers no Export for re-import to a reader without the export bit another row models', () => {
    openDataMenu(['Librarian'], [
      { role: 'Librarian', level: 0, select: 1, read: 1 },
      { role: 'Archivist', level: 0, select: 1, read: 1, export: 1 },
    ]);
    expect(screen.queryByText('ui.list.exportRoundTrip')).toBeNull();
  });

  it('offers Export for re-import to a role with the export bit', () => {
    openDataMenu(['Archivist'], [{ role: 'Archivist', level: 0, select: 1, read: 1, export: 1 }]);
    expect(screen.getByText('ui.list.exportRoundTrip')).toBeInTheDocument();
  });
});
