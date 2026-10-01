// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The engine copies a saved record into a new draft only for a user with `create` on the
 * entity and `read` on the record. The record page offers Copy to such a user and opens
 * the draft the copy route answers; a new record and a user without `create` get no Copy.
 */

const state = vi.hoisted(() => ({
  params: {} as { entity: string; name?: string },
  meta: {} as EntityDefinition,
  loaded: undefined as Record<string, unknown> | undefined,
  roles: [] as string[],
  copy: undefined as unknown as (name: string) => Promise<Record<string, unknown>>,
  navigate: undefined as unknown as (to: string) => void,
  toast: undefined as unknown as (text: string, kind?: string) => void,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => state.params,
  useNavigate: () => state.navigate,
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: (entity?: string) => ({ data: entity ? state.loaded : undefined, isLoading: false, isError: false }),
  useSingle: (entity?: string) => ({ data: entity ? state.loaded : undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: state.copy, isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({ FormRenderer: () => <div data-testid="form-fields" /> }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: state.toast }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { _id: 'u1', email: 'tom@example.com', roles: state.roles } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

function renderRecord(params: { entity: string; name?: string }, permissions: EntityPermission[]) {
  state.params = params;
  state.meta = {
    name: params.entity,
    label: params.entity,
    title_field: '_id',
    fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
    permissions,
  } as unknown as EntityDefinition;
  state.loaded = { _id: params.name, modified: 'T1', docstatus: 0, note: 'a' };
  state.copy = vi.fn();
  state.navigate = vi.fn();
  state.toast = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('RecordPage offers Copy', () => {
  it('shows Copy on a saved record to a role with create and read', () => {
    state.roles = ['Accountant'];
    renderRecord({ entity: 'Invoice', name: 'INV-1' }, [{ role: 'Accountant', level: 0, read: 1, create: 1 }]);
    expect(screen.getByRole('button', { name: 'ui.record.copy' })).toBeInTheDocument();
  });

  it('shows no Copy to a role that may read and write but not create', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'Invoice', name: 'INV-1' }, [{ role: 'Reception', level: 0, read: 1, write: 1 }]);
    expect(screen.getByTestId('form-fields')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ui.record.copy' })).toBeNull();
  });

  it('shows no Copy on a new record', () => {
    state.roles = ['Accountant'];
    renderRecord({ entity: 'Invoice' }, [{ role: 'Accountant', level: 0, read: 1, create: 1 }]);
    expect(screen.getByRole('button', { name: 'ui.action.create' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ui.record.copy' })).toBeNull();
  });

  it('copies the record and opens the draft the copy route answers', async () => {
    state.roles = ['Accountant'];
    renderRecord({ entity: 'Invoice', name: 'INV-1' }, [{ role: 'Accountant', level: 0, read: 1, create: 1 }]);
    vi.mocked(state.copy).mockResolvedValue({ _id: 'INV 7', docstatus: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'ui.record.copy' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith('/Invoice/INV%207'));
    expect(state.copy).toHaveBeenCalledWith('INV-1');
  });

  it('shows why the copy route refused and stays on the record', async () => {
    state.roles = ['Accountant'];
    renderRecord({ entity: 'Invoice', name: 'INV-1' }, [{ role: 'Accountant', level: 0, read: 1, create: 1 }]);
    vi.mocked(state.copy).mockRejectedValue(new Error('Copy refused'));
    fireEvent.click(screen.getByRole('button', { name: 'ui.record.copy' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith('Copy refused', 'error'));
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
