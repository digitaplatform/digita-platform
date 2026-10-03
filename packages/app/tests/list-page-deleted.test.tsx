// @vitest-environment jsdom
// A person who may delete records of an entity switches its list to the deleted records, sees who
// deleted each one and when, and restores one. A person who may only read gets no such display.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

const page = vi.hoisted(() => ({ search: '', setParams: vi.fn(), roles: ['Clerk'] as string[] }));
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
vi.mock('@/hooks/useList', () => ({
  useList: () => ({
    data: { rows: [{ _id: 'B-2', title: 'Still here' }], total: 1, page: 1, pageSize: 20, totalPages: 1 },
    isLoading: false,
    isError: false,
    isFetching: false,
  }),
}));
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
  listDeleted: vi.fn(),
  restoreDeleted: vi.fn(),
}));
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  listDeleted: service.listDeleted,
  restoreDeleted: service.restoreDeleted,
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
  service.listDeleted.mockClear();
  service.restoreDeleted.mockClear();
  service.listDeleted.mockResolvedValue({
    success: true,
    data: [
      { name: 'B-1', title: 'Gone again', deleted_at: '2026-10-03T08:15:00Z', deleted_by: 'clerk@library' },
      { name: 'B-1', title: 'Gone by mistake', deleted_at: '2026-10-01T16:40:00Z', deleted_by: 'clerk@library' },
    ],
  });
  service.restoreDeleted.mockResolvedValue({ success: true, data: { _id: 'B-1', title: 'Gone by mistake' } });
});

describe('the deleted records of a list', () => {
  it('PLANTED DEFECT: shows each deletion to a person who may delete, and restores the one chosen', async () => {
    renderList('display=deleted', ['Clerk']);
    expect(await screen.findByText('Gone by mistake')).toBeInTheDocument();
    expect(screen.getByText('Gone again')).toBeInTheDocument();
    expect(screen.getAllByText('clerk@library')).toHaveLength(2);
    expect(screen.queryByText('Still here')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'ui.action.restore' })[1]!);
    await waitFor(() => expect(service.restoreDeleted).toHaveBeenCalledWith('Book', 'B-1', '2026-10-01T16:40:00Z'));
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
    expect(service.listDeleted).not.toHaveBeenCalled();
  });
});
