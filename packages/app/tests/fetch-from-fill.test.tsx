// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, ApiResponse } from '@digitaplatform/shared';

/**
 * A-B001: a required top-level Link field with `fetch_from: "<source>.<path>"`
 * never filled client-side once its source Link was picked — the engine only
 * resolves `fetch_from` server-side at save, so a required target silently
 * blocked Save. This drives the REAL FormRenderer + LinkControl (unlike
 * record-page-concurrency.test.tsx, which mocks FormRenderer away) to prove
 * picking the `owner` Link live-fills the empty `zone` Link from the
 * fetched Owner doc.
 */

const getDocMock =
  vi.hoisted(() => vi.fn<(entity: string, name: string) => Promise<ApiResponse<Record<string, unknown>>>>());

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Doc', name: 'DOC-1' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));

const META = {
  name: 'Doc',
  label: 'Doc',
  title_field: '_id',
  fields: [
    { fieldname: 'owner', fieldtype: 'Link', label: 'Owner', target: 'Owner' },
    {
      fieldname: 'zone',
      fieldtype: 'Link',
      label: 'Zone',
      target: 'Zone',
      fetch_from: 'owner.zone',
      fetch_if_empty: true,
    },
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
  ],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

const LOADED = { _id: 'DOC-1', modified: 'T1', docstatus: 0 };

vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: LOADED, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({
    data: [{ _id: 'C1', display: 'Owner One' }],
    isLoading: false,
  }),
}));
vi.mock('@/services/resource', () => ({
  getDoc: getDocMock,
  getSingle: vi.fn(),
}));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) =>
    sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (
    sel: (s: { t: (k: string) => string; tEntity: (e: string, fb?: string) => string; tField: (e: string, f: string, fb?: string) => string; tSection: (e: string, s: string, fb?: string) => string }) => unknown,
  ) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, f: string, fb?: string) => fb ?? f,
      tSection: (_e: string, s: string, fb?: string) => fb ?? s,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  getDocMock.mockReset();
});

describe('A-B001: live fetch_from fill on source-Link change', () => {
  it('fills the empty zone Link from the picked Owner once resolved', async () => {
    getDocMock.mockResolvedValue({
      success: true,
      status_code: 200,
      data: { zone: 'Z1' },
      messages: [],
    });
    const user = userEvent.setup();
    renderPage();

    const ownerField = await screen.findByTestId('field:Doc:owner');
    const ownerInput = await within(ownerField).findByRole('combobox');
    await user.click(ownerInput);
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(getDocMock).toHaveBeenCalledWith('Owner', 'C1'));

    const zoneField = screen.getByTestId('field:Doc:zone');
    await waitFor(() =>
      expect((within(zoneField).getByRole('combobox') as HTMLInputElement).value).toBe('Z1'),
    );
  });
});
