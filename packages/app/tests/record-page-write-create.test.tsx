// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The engine refuses a save of an existing record without `write` and a new record without
 * `create`, both through a level-0 row of one of the user's roles. The record page offers
 * Save only with `write`, and draws the new-record form with its Create button only with
 * `create`; without it the page says the user has no access instead.
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

import RecordPage from '@/pages/RecordPage';

function renderRecord(params: { entity: string; name?: string }, permissions: EntityPermission[], isSingle = false) {
  state.params = params;
  state.meta = {
    name: params.entity,
    label: params.entity,
    title_field: '_id',
    is_single: isSingle,
    fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
    permissions,
  } as unknown as EntityDefinition;
  state.loaded = { _id: params.name ?? params.entity, modified: 'T1', docstatus: 0, note: 'a' };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('RecordPage offers Save only with write', () => {
  it('shows no Save on an existing record for a role that may read and not write', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'Technician', name: 'T-1' }, [{ role: 'Reception', level: 0, read: 1 }]);
    expect(screen.getByTestId('form-fields')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ui.action.save' })).toBeNull();
  });

  it('shows no Save on a single for a role that may read and not write', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'WorkshopSetting' }, [{ role: 'Reception', level: 0, read: 1 }], true);
    expect(screen.getByTestId('form-fields')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ui.action.save' })).toBeNull();
  });

  it('shows no Save for a write bit on a level-1 row only', () => {
    state.roles = ['Reception'];
    renderRecord({ entity: 'Technician', name: 'T-1' }, [
      { role: 'Reception', level: 0, read: 1 },
      { role: 'Reception', level: 1, read: 1, write: 1 },
    ]);
    expect(screen.queryByRole('button', { name: 'ui.action.save' })).toBeNull();
  });

  it('shows Save on an existing record for a role that may write', () => {
    state.roles = ['Lead'];
    renderRecord({ entity: 'Technician', name: 'T-1' }, [{ role: 'Lead', level: 0, read: 1, write: 1 }]);
    expect(screen.getByRole('button', { name: 'ui.action.save' })).toBeInTheDocument();
  });
});

describe('RecordPage draws a new record only with create', () => {
  it('draws no form and no Create for a role without create, and says there is no access', () => {
    state.roles = ['Technician'];
    const { container } = renderRecord({ entity: 'Invoice' }, [{ role: 'Technician', level: 0, read: 1, write: 1 }]);
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByTestId('form-fields')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ui.action.create' })).toBeNull();
    expect(screen.getByText('ui.dashboard.noAccess')).toBeInTheDocument();
  });

  it('draws no form for a create bit on a level-1 row only', () => {
    state.roles = ['Technician'];
    const { container } = renderRecord({ entity: 'Invoice' }, [
      { role: 'Technician', level: 0, read: 1, write: 1 },
      { role: 'Technician', level: 1, read: 1, write: 1, create: 1 },
    ]);
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ui.action.create' })).toBeNull();
  });

  it('draws the form with Create for a role that may create', () => {
    state.roles = ['Accountant'];
    renderRecord({ entity: 'Invoice' }, [{ role: 'Accountant', level: 0, read: 1, write: 1, create: 1 }]);
    expect(screen.getByTestId('form-fields')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ui.action.create' })).toBeInTheDocument();
  });
});
