// @vitest-environment jsdom
// A person edits the workshop's settings, a single record, and presses Cancel. As on any record the
// page asks whether to discard the edits. A single has no list to go back to: a yes puts the stored
// values back in place, a no keeps the edits.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';

const createMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const toastMock = vi.hoisted(() => vi.fn());

const META = {
  name: 'WorkshopSetting',
  label: 'Workshop setting',
  title_field: '_id',
  is_single: true,
  fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

const STORED = { _id: 'WorkshopSetting', modified: 'T1', docstatus: 0, note: 'stored' };

vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
  useSingle: () => ({ data: STORED, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: confirmMock, toast: toastMock }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) =>
    sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (
    sel: (s: {
      t: (k: string) => string;
      tEntity: (e: string, fb?: string) => string;
      tField: (e: string, f: string, fb?: string) => string;
    }) => unknown,
  ) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, f: string, fb?: string) => fb ?? f,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

function renderSingle() {
  const router = createMemoryRouter([{ path: '/:entity', element: <RecordPage /> }], {
    initialEntries: ['/WorkshopSetting'],
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function editNote() {
  const field = await screen.findByTestId('field:WorkshopSetting:note');
  const input = await within(field).findByRole('textbox');
  await userEvent.type(input, ' edited');
  expect(input).toHaveValue('stored edited');
  return input;
}

function discardAsked() {
  return confirmMock.mock.calls.some(
    (args) => (args[0] as { title?: string } | undefined)?.title === 'ui.record.discardTitle',
  );
}

afterEach(() => {
  cleanup();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

describe('Cancel on a single record with unsaved edits', () => {
  it('asks to discard them, and a yes restores the stored values', async () => {
    const router = renderSingle();
    const input = await editNote();

    await userEvent.click(screen.getByRole('button', { name: 'ui.action.cancel' }));

    await waitFor(() => expect(discardAsked()).toBe(true));
    await waitFor(() => expect(input).toHaveValue('stored'));
    expect(router.state.location.pathname).toBe('/WorkshopSetting');
  });

  it('keeps the edits on a no', async () => {
    confirmMock.mockResolvedValue(false);
    renderSingle();
    const input = await editNote();

    await userEvent.click(screen.getByRole('button', { name: 'ui.action.cancel' }));

    await waitFor(() => expect(discardAsked()).toBe(true));
    expect(input).toHaveValue('stored edited');
  });
});
