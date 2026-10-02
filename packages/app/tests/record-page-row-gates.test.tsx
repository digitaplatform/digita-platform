// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * The engine grants an action on a record through a row only when the row's gates admit the
 * stored record: `if_owner` (the user owns it), `condition` (the expression holds for it) and
 * `scope` (its scope field holds the user's value). The record page offers Delete and Save
 * only where such a row admits the loaded record.
 */

const state = vi.hoisted(() => ({
  meta: {} as EntityDefinition,
  loaded: {} as Record<string, unknown>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Loan', name: 'L-1' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: state.loaded, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { _id: 'u-ann', email: 'ann@example.com', roles: ['Borrower'] } }),
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

function renderLoan(permissions: EntityPermission[], loan: Record<string, unknown>) {
  state.meta = {
    name: 'Loan',
    label: 'Loan',
    title_field: '_id',
    fields: [{ fieldname: 'status', fieldtype: 'Data', label: 'Status' }],
    permissions,
  } as unknown as EntityDefinition;
  state.loaded = { _id: 'L-1', modified: 'T1', docstatus: 0, ...loan };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

const deleteButton = () => screen.queryByRole('button', { name: 'ui.action.delete' });
const saveButton = () => screen.queryByRole('button', { name: 'ui.action.save' });

afterEach(cleanup);

describe('RecordPage evaluates if_owner on the loaded record', () => {
  const ownDelete: EntityPermission = { role: 'Borrower', level: 0, read: 1, delete: 1, if_owner: true };

  it("offers no Delete on another user's record", () => {
    renderLoan([ownDelete], { owner: 'bob@example.com' });
    expect(deleteButton()).toBeNull();
  });

  it('offers Delete to the owner named by email, and not to one named by id, as the engine matches the email', () => {
    renderLoan([ownDelete], { owner: 'ann@example.com' });
    expect(deleteButton()).toBeInTheDocument();
    cleanup();
    renderLoan([ownDelete], { owner: 'u-ann' });
    expect(deleteButton()).toBeNull();
  });

  it("offers Delete on another user's record through a row without if_owner", () => {
    renderLoan([ownDelete, { role: 'Borrower', level: 0, read: 1, delete: 1 }], { owner: 'bob@example.com' });
    expect(deleteButton()).toBeInTheDocument();
  });

  it('leaves Delete to the engine when the record does not show its owner to this reader', () => {
    renderLoan([ownDelete], {});
    expect(deleteButton()).toBeInTheDocument();
  });

  it("offers no Save on another user's record where write needs ownership", () => {
    renderLoan([{ role: 'Borrower', level: 0, read: 1, write: 1, if_owner: true }], { owner: 'bob@example.com' });
    expect(saveButton()).toBeNull();
    cleanup();
    renderLoan([{ role: 'Borrower', level: 0, read: 1, write: 1, if_owner: true }], { owner: 'ann@example.com' });
    expect(saveButton()).toBeInTheDocument();
  });
});

describe('RecordPage evaluates condition on the loaded record', () => {
  const draftDelete: EntityPermission = {
    role: 'Borrower',
    level: 0,
    read: 1,
    delete: 1,
    condition: "eval:doc.status == 'Draft'",
  };

  it('offers no Delete where the condition does not hold', () => {
    renderLoan([draftDelete], { owner: 'ann@example.com', status: 'Returned' });
    expect(deleteButton()).toBeNull();
  });

  it('offers Delete where the condition holds', () => {
    renderLoan([draftDelete], { owner: 'ann@example.com', status: 'Draft' });
    expect(deleteButton()).toBeInTheDocument();
  });
});

describe('RecordPage evaluates scope on the loaded record', () => {
  it('offers no Delete on a record outside the scope the session names', () => {
    const scoped: EntityPermission = {
      role: 'Borrower',
      level: 0,
      read: 1,
      delete: 1,
      scope: { field: 'librarian', user_field: 'email' },
    };
    renderLoan([scoped], { librarian: 'carl@example.com' });
    expect(deleteButton()).toBeNull();
    cleanup();
    renderLoan([scoped], { librarian: ['carl@example.com', 'ann@example.com'] });
    expect(deleteButton()).toBeInTheDocument();
  });

  it('leaves Delete to the engine for a scope on a user attribute the session does not carry', () => {
    renderLoan([{ role: 'Borrower', level: 0, read: 1, delete: 1, scope: { field: 'branch', user_field: 'branch' } }], {
      branch: 'North',
    });
    expect(deleteButton()).toBeInTheDocument();
  });
});
