// @vitest-environment jsdom
// A person who may delete records of an entity switches its list to the deleted records, sees who
// deleted each one and when, and restores one. A person who may only read gets no such display.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

const page = vi.hoisted(() => ({ search: '', setParams: vi.fn(), roles: ['Clerk'] as string[], list: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Book' }),
  useSearchParams: () => [new URLSearchParams(page.search), page.setParams],
  useNavigate: () => vi.fn(),
}));
const META = vi.hoisted(
  () =>
    ({
      name: 'Book',
      label: 'Book',
      title_field: 'title',
      fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
      permissions: [
        { role: 'Clerk', level: 0, select: 1, read: 1, delete: 1 },
        { role: 'Reader', level: 0, select: 1, read: 1 },
      ],
    }) as unknown as EntityDefinition,
);
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useList', () => ({ useList: page.list }));
vi.mock('@/hooks/useListPreferences', () => ({
  useListPreferences: () => ({ views: [], defaultView: undefined, isLoading: false, isAdmin: false, canEdit: () => false }),
}));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast }),
}));
vi.mock('@/components/record/RecordDialog', () => ({ RecordDialog: () => null }));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (k: string, p?: Record<string, string>) => (p ? `${k} ${JSON.stringify(p)}` : k),
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: unknown }) => unknown) =>
    sel({ user: { roles: page.roles }, locale: { code: 'en', format_locale: 'en-GB', timezone: 'UTC' } }),
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
const service = vi.hoisted(() => ({
  restoreDoc: vi.fn(),
}));
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  restoreDoc: service.restoreDoc,
}));

import ListPage from '@/pages/ListPage';

function renderList(search: string, roles: string[]) {
  page.search = search;
  page.roles = roles;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ListPage />
    </QueryClientProvider>,
  );
}

const lastWrite = () => Object.fromEntries(page.setParams.mock.lastCall![0] as URLSearchParams);

beforeEach(() => {
  toast.mockClear();
  page.setParams.mockClear();
  page.list.mockClear();
  page.list.mockImplementation((_entity: string, params: { filters: Array<[string, string, unknown]> }) => ({
    data: {
      rows: params.filters.some(([field]) => field === 'deleted')
        ? [{ _id: 'B-1', title: 'Gone by mistake', deleted: '2026-10-01T16:40:00Z', deleted_by: 'clerk@library' }]
        : [{ _id: 'B-2', title: 'Still here' }],
      total: 1, page: 1, pageSize: 20, totalPages: 1,
    }, isLoading: false, isError: false, isFetching: false,
  }));
  service.restoreDoc.mockReset();
  service.restoreDoc.mockResolvedValue({ success: true, data: { _id: 'B-1', title: 'Gone by mistake' } });
});

describe('the deleted records of a list', () => {
  it('PLANTED DEFECT: uses the normal list deletion filter and restores a retained row', async () => {
    renderList('display=deleted', ['Clerk']);
    expect(await screen.findByText('Gone by mistake')).toBeInTheDocument();
    expect(screen.getAllByText('clerk@library')).toHaveLength(1);
    expect(screen.queryByText('Still here')).toBeNull();
    expect(page.list.mock.lastCall![1].filters).toContainEqual(['deleted', 'is', 'set']);
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.restore' }));
    await waitFor(() => expect(service.restoreDoc).toHaveBeenCalledWith('Book', 'B-1'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('ui.list.restored {"name":"B-1"}', 'success'));
  });

  it('drops the list query when the display moves to the deleted records', () => {
    renderList(new URLSearchParams({ q: 'rose' }).toString(), ['Clerk']);
    fireEvent.click(screen.getByRole('radio', { name: 'ui.list.viewDeleted' }));
    expect(lastWrite()).toEqual({ display: 'deleted' });
  });

  it('PLANTED INNOCENT: offers no deleted display to a person who may only read', () => {
    renderList('display=deleted', ['Reader']);
    expect(screen.queryByRole('radio', { name: 'ui.list.viewDeleted' })).toBeNull();
    expect(screen.getByText('Still here')).toBeInTheDocument();
    expect(page.list.mock.lastCall![1].filters).not.toContainEqual(['deleted', 'is', 'set']);
  });

  it('retains enabled previous navigation back to page 1 on an empty page 2 when total is 20', () => {
    page.list.mockReturnValue({
      data: {
        rows: [],
        total: 20,
        page: 2,
        pageSize: 20,
        totalPages: 1,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderList('display=deleted&page=2', ['Clerk']);
    expect(screen.queryByTestId('deleted-empty')).toBeNull();
    const prevBtn = screen.getByRole('button', { name: 'ui.list.previous' });
    expect(prevBtn).not.toBeDisabled();
    fireEvent.click(prevBtn);
    expect(lastWrite()).toMatchObject({ display: 'deleted', page: '1' });
  });

  it('retains no-deleted empty state when total is 0', () => {
    page.list.mockReturnValue({
      data: {
        rows: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    renderList('display=deleted', ['Clerk']);
    expect(screen.getByTestId('deleted-empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ui.list.previous' })).toBeNull();
  });
});
