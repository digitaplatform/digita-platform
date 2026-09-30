// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * Data > Export for re-import asks the engine for the rows the list shows: the request carries
 * the list's AND filters, its OR filters and its search, never the AND filters alone, so the
 * file cannot hold rows the user filtered out.
 */

const state = vi.hoisted(() => ({ params: new URLSearchParams(), get: vi.fn() }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Book' }),
  useSearchParams: () => [state.params, vi.fn()],
  useNavigate: () => vi.fn(),
}));
vi.mock('@/services/api', () => ({ api: { get: state.get } }));
vi.mock('@/lib/csv', () => ({ buildListCsv: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({
    data: {
      name: 'Book',
      label: 'Book',
      title_field: 'title',
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title' },
        { fieldname: 'genre', fieldtype: 'Data', label: 'Genre' },
        { fieldname: 'shelf', fieldtype: 'Data', label: 'Shelf' },
      ],
      permissions: [{ role: 'Archivist', level: 0, select: 1, read: 1, export: 1 }],
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
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: string }) => unknown) =>
    sel({ user: { roles: ['Archivist'] }, locale: 'en' }),
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

function exportForReimport(params: Record<string, string>) {
  state.params = new URLSearchParams(params);
  state.get.mockReset();
  state.get.mockResolvedValue('title\n');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ListPage />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'ui.list.dataMenu' }));
  fireEvent.click(screen.getByText('ui.list.exportRoundTrip'));
}

afterEach(cleanup);

describe('ListPage export for re-import carries the list query', () => {
  it('sends the OR filters and the search along with the AND filters', async () => {
    exportForReimport({
      f: JSON.stringify([['genre', '=', 'Poetry']]),
      of: JSON.stringify([
        ['shelf', '=', 'A'],
        ['shelf', '=', 'B'],
      ]),
      q: 'rose',
    });

    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
    expect(state.get).toHaveBeenCalledWith('/api/v1/export/Book', {
      format: 'csv',
      round_trip: true,
      filters: JSON.stringify([['genre', '=', 'Poetry']]),
      or_filters: JSON.stringify([
        ['shelf', '=', 'A'],
        ['shelf', '=', 'B'],
      ]),
      search: 'rose',
    });
  });

  it('sends the AND filters alone for a list without OR filters or a search', async () => {
    exportForReimport({ f: JSON.stringify([['genre', '=', 'Poetry']]) });

    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
    expect(state.get).toHaveBeenCalledWith('/api/v1/export/Book', {
      format: 'csv',
      round_trip: true,
      filters: JSON.stringify([['genre', '=', 'Poetry']]),
    });
  });
});
