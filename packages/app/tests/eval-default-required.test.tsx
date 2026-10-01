// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * The engine evaluates an `eval:` default when it inserts a record, and refuses the field
 * there when the expression yields nothing. The record page and the record dialog leave
 * such a field empty on a new record, so they must not refuse the save themselves. A
 * stored record gets no default on update, so there the form still refuses the empty field.
 */

const state = vi.hoisted(() => ({
  params: {} as { entity: string; name?: string },
  loaded: undefined as Record<string, unknown> | undefined,
  errors: {} as Record<string, string>,
  create: undefined as unknown as ReturnType<typeof vi.fn>,
  update: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => state.params,
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: (entity?: string) => ({ data: entity ? state.loaded : undefined, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdate: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({
  FormRenderer: ({ errors }: { errors: Record<string, string> }) => {
    state.errors = errors;
    return null;
  },
}));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: Record<string, unknown> }) => unknown) =>
    sel({ user: { _id: 'u1', email: 'ann@example.com', roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e, tOption: (_e: string, _f: string, v: string) => v }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

const meta = {
  name: 'Loan',
  label: 'Loan',
  title_field: '_id',
  permissions: [],
  fields: [
    { fieldname: 'days', fieldtype: 'Int', label: 'Days', default: 14 },
    { fieldname: 'due_note', fieldtype: 'Data', label: 'Due note', required: true, default: 'eval:doc.days * 2' },
  ],
} as unknown as EntityDefinition;

import RecordPage from '@/pages/RecordPage';
import { RecordDialog } from '@/components/record/RecordDialog';

function renderRecord(params: { entity: string; name?: string }) {
  state.params = params;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.errors = {};
  state.create = vi.fn().mockResolvedValue({ _id: 'L-1', days: 14, due_note: '28' });
  state.update = vi.fn().mockResolvedValue({ _id: 'L-1', modified: 'T2', days: 14 });
});
afterEach(cleanup);

describe('RecordPage leaves a required eval: default to the engine on insert', () => {
  it('creates a new record whose required field has an eval: default and is still empty', async () => {
    renderRecord({ entity: 'Loan' });
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.create' }));

    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    const body = state.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(body['days']).toBe(14);
    expect('due_note' in body).toBe(false);
    expect(state.errors['due_note']).toBeUndefined();
  });

  it('still refuses the empty field on a stored record, which gets no default on update', async () => {
    state.loaded = { _id: 'L-1', modified: 'T1', docstatus: 0, days: 14 };
    renderRecord({ entity: 'Loan', name: 'L-1' });
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.save' }));

    await waitFor(() => expect(state.errors['due_note']).toBeTruthy());
    expect(state.update).not.toHaveBeenCalled();
  });
});

describe('RecordDialog leaves a required eval: default to the engine on insert', () => {
  it('creates a new record whose required field has an eval: default and is still empty', async () => {
    render(<RecordDialog open onClose={vi.fn()} entity="Loan" meta={meta} />);
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.create' }));

    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect('due_note' in (state.create.mock.calls[0]![0] as Record<string, unknown>)).toBe(false);
  });
});
