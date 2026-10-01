// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, EntityPermission } from '@digitaplatform/shared';

/**
 * A workflow state may strip `write` or `delete` from a role (`states[].permissions`). The
 * engine then refuses a save or a delete of a record in that state for a user whose every
 * role that grants the bit is stripped. The record page locks the form and offers neither
 * Save nor Delete there, the way it does for a submitted document; a state without a strip,
 * or another role of the user that keeps the bit, leaves the record editable.
 */

const state = vi.hoisted(() => ({
  meta: {} as EntityDefinition,
  loaded: {} as Record<string, unknown>,
  roles: [] as string[],
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'WorkOrder', name: 'WO-1' }),
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
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { _id: 'u1', email: 'rita@example.com', roles: state.roles } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, _f: string, fb?: string) => fb ?? '',
      tOption: (_e: string, _f: string, v: string) => v,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

const RECEPTION: EntityPermission = { role: 'Reception', level: 0, read: 1, write: 1, create: 1, delete: 1 };
const LEAD: EntityPermission = { role: 'Lead', level: 0, read: 1, write: 1 };

function renderWorkOrder(status: string, permissions: EntityPermission[], strip: Record<string, 0>) {
  state.meta = {
    name: 'WorkOrder',
    label: 'Work Order',
    title_field: '_id',
    fields: [
      { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
      {
        fieldname: 'parts',
        fieldtype: 'Table',
        label: 'Parts',
        child_fields: [{ fieldname: 'part', fieldtype: 'Data', label: 'Part' }],
      },
    ],
    permissions,
    states: [
      { value: 'open', color: 'blue', is_initial: true },
      { value: 'in_repair', color: 'amber', permissions: [{ role: 'Reception', ...strip }] },
    ],
  } as unknown as EntityDefinition;
  state.loaded = {
    _id: 'WO-1',
    modified: 'T1',
    docstatus: 0,
    status,
    note: 'Brakes squeal',
    parts: [{ _row_id: 'r1', part: 'P-1' }],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('RecordPage in a workflow state that strips a permission', () => {
  it('locks every field, offers no Save and lets the grid add no row where write is stripped', async () => {
    state.roles = ['Reception'];
    renderWorkOrder('in_repair', [RECEPTION], { write: 0 });

    expect(await screen.findByRole('textbox', { name: 'Note' })).toHaveAttribute('readonly');
    expect(await screen.findByRole('grid', { name: 'Parts' })).toHaveAttribute('aria-rowcount', '2');
    expect(screen.queryByRole('button', { name: 'ui.table.addRow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ui.action.save' })).toBeNull();
  });

  it('keeps the record editable in a state without a strip', async () => {
    state.roles = ['Reception'];
    renderWorkOrder('open', [RECEPTION], { write: 0 });

    expect(await screen.findByRole('textbox', { name: 'Note' })).not.toHaveAttribute('readonly');
    const grid = await screen.findByRole('grid', { name: 'Parts' });
    fireEvent.click(screen.getByRole('button', { name: 'ui.table.addRow' }));
    expect(grid).toHaveAttribute('aria-rowcount', '3');
    expect(screen.getByRole('button', { name: 'ui.action.save' })).toBeInTheDocument();
  });

  it('keeps the record editable for a user whose other role keeps write in that state', async () => {
    state.roles = ['Reception', 'Lead'];
    renderWorkOrder('in_repair', [RECEPTION, LEAD], { write: 0 });

    expect(await screen.findByRole('textbox', { name: 'Note' })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'ui.table.addRow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ui.action.save' })).toBeInTheDocument();
  });

  it('offers no Delete where delete is stripped, and Delete in a state without a strip', async () => {
    state.roles = ['Reception'];
    renderWorkOrder('in_repair', [RECEPTION], { delete: 0 });
    await screen.findByRole('textbox', { name: 'Note' });
    expect(screen.queryByRole('button', { name: 'ui.action.delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ui.action.save' })).toBeInTheDocument();
    cleanup();

    renderWorkOrder('open', [RECEPTION], { delete: 0 });
    await screen.findByRole('textbox', { name: 'Note' });
    expect(screen.getByRole('button', { name: 'ui.action.delete' })).toBeInTheDocument();
  });
});
