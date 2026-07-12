// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { ApiClientError } from '@/lib/errors';

/**
 * Optimistic-concurrency contract of RecordPage's save flow:
 *  1. the loaded `modified` is sent as the If-Match (`expectedModified`)
 *  2. it advances after a successful save (so a second save can't 409 on a stale base)
 *  3. a 409 surfaces the conflict banner and disables save (no blind clobber/retry)
 *
 * Mocks the hook + IO layer so the component runs synchronously; the real bits under
 * test (RecordForm's baseModified state machine, RHF + zod) stay real.
 */

const updateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Widget', name: 'W-1' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));

const META = {
  name: 'Widget',
  label: 'Widget',
  title_field: '_id',
  fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

const LOADED = { _id: 'W-1', modified: 'T1', docstatus: 0, note: 'a' };

vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: LOADED, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: updateMock, isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({ FormRenderer: () => null }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
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
    sel: (s: { t: (k: string) => string; tEntity: (e: string, fb?: string) => string }) => unknown,
  ) => sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e }),
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
  updateMock.mockReset();
});

describe('RecordPage optimistic concurrency (If-Match)', () => {
  it('sends the loaded `modified` as expectedModified on save', async () => {
    updateMock.mockResolvedValue({ ...LOADED, modified: 'T2' });
    const { getByRole } = renderPage();
    await userEvent.click(getByRole('button', { name: 'ui.action.save' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'W-1', expectedModified: 'T1' }),
    );
  });

  it('advances the If-Match base after a successful save', async () => {
    updateMock.mockResolvedValueOnce({ ...LOADED, modified: 'T2' });
    updateMock.mockResolvedValueOnce({ ...LOADED, modified: 'T3' });
    const { getByRole } = renderPage();
    await userEvent.click(getByRole('button', { name: 'ui.action.save' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    await userEvent.click(getByRole('button', { name: 'ui.action.save' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    expect(updateMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ expectedModified: 'T1' }));
    expect(updateMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedModified: 'T2' }));
  });

  it('on a 409 shows the conflict banner and disables save', async () => {
    updateMock.mockRejectedValue(new ApiClientError('conflict', 409));
    const { getByRole, queryByRole } = renderPage();
    await userEvent.click(getByRole('button', { name: 'ui.action.save' }));
    await waitFor(() => expect(queryByRole('alert')).not.toBeNull());
    const saveBtn = getByRole('button', { name: 'ui.action.save' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });
});
