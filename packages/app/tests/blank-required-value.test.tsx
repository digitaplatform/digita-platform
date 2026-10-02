// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * The engine refuses a whitespace-only value in a required field and a blank required
 * Table cell with field_required. The record page and the record dialog refuse both
 * themselves, at the field, before they send the request: the grid draws no message per
 * cell, so the Table shows it.
 */

const state = vi.hoisted(() => ({
  errors: {} as Record<string, string>,
  onFieldChange: undefined as unknown as (fieldname: string, value: unknown) => void,
  create: undefined as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Order' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({
  FormRenderer: (p: { errors: Record<string, string>; onFieldChange: (f: string, v: unknown) => void }) => {
    state.errors = p.errors;
    state.onFieldChange = p.onFieldChange;
    return null;
  },
}));
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
    sel({
      // Each parameter a message names is shown, so a test reads what the form filled in.
      t: (k: string, p?: Record<string, unknown>) =>
        [k, p?.field, p?.min, p?.max].filter((v) => v !== undefined).join(': '),
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, f: string, fb?: string) => fb ?? f,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

const meta = {
  name: 'Order',
  label: 'Order',
  title_field: '_id',
  permissions: [],
  fields: [
    { fieldname: 'customer', fieldtype: 'Data', label: 'Customer', required: true },
    { fieldname: 'code', fieldtype: 'Data', label: 'Code', max_length: 3 },
    { fieldname: 'qty', fieldtype: 'Int', label: 'Qty', min_value: 1 },
    {
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      max_rows: 2,
      child_fields: [
        { fieldname: 'sku', fieldtype: 'Data', label: 'SKU', required: true },
        { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
      ],
    },
  ],
} as unknown as EntityDefinition;

import RecordPage from '@/pages/RecordPage';
import { RecordDialog } from '@/components/record/RecordDialog';

async function saveWith(values: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
  act(() => {
    for (const [fieldname, value] of Object.entries(values)) state.onFieldChange(fieldname, value);
  });
  fireEvent.click(screen.getByRole('button', { name: 'ui.action.create' }));
}

beforeEach(() => {
  state.errors = {};
  state.create = vi.fn().mockResolvedValue({ _id: 'O-1' });
});
afterEach(cleanup);

describe('RecordPage refuses a blank required value before it sends the record', () => {
  it('refuses a whitespace-only value in a required field at that field', async () => {
    await saveWith({ customer: '   ', lines: [{ _row_id: 'r1', sku: 'A-1' }] });

    await waitFor(() => expect(state.errors['customer']).toBe('field_required: Customer'));
    expect(state.create).not.toHaveBeenCalled();
  });

  it('refuses a blank and a whitespace-only required Table cell at the Table', async () => {
    await saveWith({ customer: 'Ann', lines: [{ _row_id: 'r1', sku: 'A-1' }, { _row_id: 'r2', sku: '' }] });
    await waitFor(() => expect(state.errors['lines']).toBe('field_required: Lines: SKU'));
    expect(state.create).not.toHaveBeenCalled();
    cleanup();

    await saveWith({ customer: 'Ann', lines: [{ _row_id: 'r1', sku: '  ' }] });
    await waitFor(() => expect(state.errors['lines']).toBe('field_required: Lines: SKU'));
    expect(state.create).not.toHaveBeenCalled();
  });

  it('fills the limit a message names: the length, the value and the row count', async () => {
    await saveWith({
      customer: 'Ann',
      code: 'Anna',
      qty: 0,
      lines: [{ _row_id: 'r1', sku: 'A' }, { _row_id: 'r2', sku: 'B' }, { _row_id: 'r3', sku: 'C' }],
    });
    await waitFor(() => expect(state.errors['code']).toBe('field_max_length: Code: 3'));
    expect(state.errors['qty']).toBe('field_min_value: Qty: 1');
    expect(state.errors['lines']).toBe('table_max_rows: Lines: 2');
    expect(state.create).not.toHaveBeenCalled();
  });

  it('sends a record whose required field and cells hold values, with an optional cell left empty', async () => {
    await saveWith({ customer: 'Ann', lines: [{ _row_id: 'r1', sku: 'A-1', note: '' }] });

    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(state.errors).toEqual({});
  });
});

describe('RecordDialog refuses a blank required Table cell before it sends the record', () => {
  it('shows field_required at the Table and sends nothing', async () => {
    render(<RecordDialog open onClose={vi.fn()} entity="Order" meta={meta} />);
    act(() => {
      state.onFieldChange('customer', 'Ann');
      state.onFieldChange('lines', [{ _row_id: 'r1', sku: ' ' }]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.create' }));

    await waitFor(() => expect(state.errors['lines']).toBe('field_required: Lines: SKU'));
    expect(state.create).not.toHaveBeenCalled();
  });

  it('PLANTED DEFECT: fills the limit a message names, as the record page does', async () => {
    render(<RecordDialog open onClose={vi.fn()} entity="Order" meta={meta} />);
    act(() => {
      state.onFieldChange('customer', 'Ann');
      state.onFieldChange('code', 'Anna');
      state.onFieldChange('lines', [{ _row_id: 'r1', sku: 'A' }]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.create' }));

    await waitFor(() => expect(state.errors['code']).toBe('field_max_length: Code: 3'));
    expect(state.create).not.toHaveBeenCalled();
  });
});
