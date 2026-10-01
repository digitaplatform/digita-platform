// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The history routes answer only a reader of the record, and only a saved record has a
 * history, so the record page mounts the history panel for a saved record its reader opens.
 */

const state = vi.hoisted(() => ({
  params: {} as { entity: string; name?: string },
  meta: {} as EntityDefinition,
  loaded: undefined as Record<string, unknown> | undefined,
  roles: [] as string[],
}));

vi.mock('react-router-dom', () => ({
  useParams: () => state.params,
  useNavigate: () => vi.fn(),
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
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
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

vi.mock('@/components/record/HistoryPanel', () => ({
  HistoryPanel: ({ entity, name }: { entity: string; name: string }) => (
    <div data-testid="history-panel">{`${entity} ${name}`}</div>
  ),
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
  state.loaded = { _id: params.name, modified: 'T1', docstatus: 0, note: 'a', owner: 'ann@example.com' };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('RecordPage history panel', () => {
  it('shows the history of a saved record to a role that may read it', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'Customer', name: 'C-1' }, [{ role: 'Reception', level: 0, read: 1 }]);
    expect(screen.getByTestId('history-panel')).toHaveTextContent('Customer C-1');
  });

  it('shows no history to a role whose read holds only on its own records', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'Customer', name: 'C-1' }, [{ role: 'Reception', level: 0, read: 1, write: 1, if_owner: true }]);
    expect(screen.getByTestId('form-fields')).toBeInTheDocument();
    expect(screen.queryByTestId('history-panel')).toBeNull();
  });

  it('shows no history on a new record', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'Customer' }, [{ role: 'Reception', level: 0, read: 1, create: 1 }]);
    expect(screen.getByRole('button', { name: 'ui.action.create' })).toBeInTheDocument();
    expect(screen.queryByTestId('history-panel')).toBeNull();
  });
});
