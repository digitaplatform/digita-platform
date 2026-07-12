// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  Link,
  type RouteObject,
} from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * F2 dirty-guard contract of RecordPage. Unlike the other RecordPage tests, this
 * one drives the REAL react-router data router (createMemoryRouter) and the REAL
 * FormRenderer — because the defect lives in the interaction between useBlocker
 * and RHF's `formState.isDirty`, which a stubbed router/renderer can't exercise.
 *
 * The bug: RHF flips `isDirty` on its internal control synchronously inside
 * form.reset(), but the `formState.isDirty` the blocker reads is a render snapshot
 * that only updates on the NEXT React render. A successful save calls reset() then
 * navigate() in the SAME tick, so the blocker still saw a stale `true` and popped a
 * spurious "discard changes?" prompt. The fix bypasses the guard for the
 * programmatic post-save navigation. The guard must still fire for real edits.
 */

const createMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const toastMock = vi.hoisted(() => vi.fn());

const META = {
  name: 'Doc',
  label: 'Doc',
  title_field: '_id',
  fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

const LOADED = { _id: 'D-1', modified: 'T1', docstatus: 0, note: 'a' };

vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: LOADED, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
      tSection: (e: string, s: string, fb?: string) => string;
    }) => unknown,
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

/** Persistent shell with an in-app link, so a genuine dirty navigation can be triggered. */
function Shell() {
  return (
    <>
      <nav>
        <Link to="/elsewhere">go-elsewhere</Link>
      </nav>
      <Outlet />
    </>
  );
}

function renderAt(initialPath: string) {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: <Shell />,
      children: [
        { path: 'elsewhere', element: <div>elsewhere-page</div> },
        { path: ':entity', element: <RecordPage /> },
        { path: ':entity/:name', element: <RecordPage /> },
      ],
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Was the discard prompt shown? (discriminated from the save-confirm by its title.) */
function discardPromptShown() {
  return confirmMock.mock.calls.some(
    (args) => (args[0] as { title?: string } | undefined)?.title === 'ui.record.discardTitle',
  );
}

async function typeInNote() {
  const field = await screen.findByTestId('field:Doc:note');
  const input = await within(field).findByRole('textbox');
  await userEvent.type(input, 'x');
  return input;
}

afterEach(() => {
  cleanup();
  createMock.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  toastMock.mockReset();
});

describe('RecordPage dirty-guard on post-save navigation (F2)', () => {
  it('does NOT show the discard prompt after a successful create + navigate', async () => {
    createMock.mockResolvedValue({ _id: 'D-1', modified: 'T2', docstatus: 0, note: 'x' });
    const router = renderAt('/Doc');

    // Edit the new record so it is genuinely dirty (reproduces the stale-snapshot race).
    await typeInNote();
    await userEvent.click(await screen.findByRole('button', { name: 'ui.action.create' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // The programmatic post-save navigation must go through, not be blocked.
    await waitFor(() => expect(router.state.location.pathname).toBe('/Doc/D-1'));
    expect(discardPromptShown()).toBe(false);
  });

  it('DOES show the discard prompt when navigating away with real unsaved edits', async () => {
    renderAt('/Doc/D-1');

    await typeInNote(); // genuine unsaved edit → guard must engage
    await userEvent.click(screen.getByRole('link', { name: 'go-elsewhere' }));

    await waitFor(() => expect(discardPromptShown()).toBe(true));
  });

  it('does NOT show the discard prompt when navigating away with no edits', async () => {
    const router = renderAt('/Doc/D-1');

    // Ensure the record form mounted, then navigate without touching any field.
    await screen.findByTestId('field:Doc:note');
    await userEvent.click(screen.getByRole('link', { name: 'go-elsewhere' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/elsewhere'));
    expect(discardPromptShown()).toBe(false);
  });
});
