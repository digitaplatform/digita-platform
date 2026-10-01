// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, ApiResponse } from '@digitaplatform/shared';
import { ApiClientError } from '@/lib/errors';

/**
 * Picking a Link reads the picked record to fill the empty fields whose `fetch_from` reads
 * from it. A read that fails says so at the Link, naming the fields it was for; a silent
 * failure leaves them empty with no reason. A sub-row Link (`target_path`) holds
 * `<parent id>::<row id>`, so the form reads the parent and fills from that row, as the
 * engine does on save. Drives the real FormRenderer and LinkControl.
 */

const state = vi.hoisted(() => ({
  meta: {} as EntityDefinition,
  options: [] as Array<{ _id: string; display: string }>,
  getDoc: undefined as unknown as (entity: string, name: string) => Promise<ApiResponse<Record<string, unknown>>>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Visit', name: 'V-1' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: { _id: 'V-1', modified: 'T1', docstatus: 0 }, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: state.options, isLoading: false }),
}));
vi.mock('@/services/resource', () => ({
  getDoc: (entity: string, name: string) => state.getDoc(entity, name),
  getSingle: vi.fn(),
}));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      locale: 'en',
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, f: string, fb?: string) => fb ?? f,
      tSection: (_e: string, s: string, fb?: string) => fb ?? s,
      tOption: (_e: string, _f: string, v: string) => v,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

async function pick(fieldname: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const field = await screen.findByTestId(`field:Visit:${fieldname}`);
  await user.click(await within(field).findByRole('combobox'));
  await user.keyboard('{ArrowDown}{Enter}');
  return field;
}

const comboboxValue = (fieldname: string) =>
  (within(screen.getByTestId(`field:Visit:${fieldname}`)).getByRole('combobox') as HTMLInputElement).value;

afterEach(cleanup);

describe('RecordPage shows a fetch_from read that fails', () => {
  it('says at the Link which fields it could not fill, and why', async () => {
    state.meta = {
      name: 'Visit',
      label: 'Visit',
      title_field: '_id',
      permissions: [],
      fields: [
        { fieldname: 'customer', fieldtype: 'Link', label: 'Customer', target: 'Customer' },
        { fieldname: 'city', fieldtype: 'Data', label: 'City', fetch_from: 'customer.city' },
        { fieldname: 'phone', fieldtype: 'Data', label: 'Phone', fetch_from: 'customer.phone' },
      ],
    } as unknown as EntityDefinition;
    state.options = [{ _id: 'C-1', display: 'Customer One' }];
    state.getDoc = () => Promise.reject(new ApiClientError('You may not read Customer C-1', 403));

    const customer = await pick('customer');

    expect(
      await within(customer).findByText('City, Phone could not be filled from this record: You may not read Customer C-1'),
    ).toBeVisible();
  });

  it('drops the message when the Link is picked again and the read succeeds', async () => {
    state.options = [
      { _id: 'C-1', display: 'Customer One' },
      { _id: 'C-2', display: 'Customer Two' },
    ];
    state.getDoc = (_entity, name) =>
      name === 'C-1'
        ? Promise.reject(new ApiClientError('You may not read Customer C-1', 403))
        : Promise.resolve({ success: true, status_code: 200, data: { city: 'Basel', phone: '061' }, messages: [] });

    const customer = await pick('customer');
    expect(await within(customer).findByText(/could not be filled/)).toBeVisible();

    const user = userEvent.setup();
    await user.click(within(customer).getByRole('combobox'));
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.getByTestId('field:Visit:city').querySelector('input')?.value).toBe('Basel'));
    expect(within(customer).queryByText(/could not be filled/)).toBeNull();
    state.options = [{ _id: 'C-1', display: 'Customer One' }];
  });

  it('shows no message when the read succeeds', async () => {
    state.getDoc = () => Promise.resolve({ success: true, status_code: 200, data: { city: 'Bern', phone: '031' }, messages: [] });

    const customer = await pick('customer');

    await waitFor(() => expect(screen.getByTestId('field:Visit:city').querySelector('input')?.value).toBe('Bern'));
    expect(within(customer).queryByText(/could not be filled/)).toBeNull();
  });
});

describe('RecordPage fills fetch_from fields from the row a sub-row Link picks', () => {
  const visitWithSlot = {
    name: 'Visit',
    label: 'Visit',
    title_field: '_id',
    permissions: [],
    fields: [
      { fieldname: 'slot', fieldtype: 'Link', label: 'Slot', target: 'Garage', target_path: 'bays' },
      { fieldname: 'bay', fieldtype: 'Link', label: 'Bay', target: 'Bay', fetch_from: 'slot.bay' },
    ],
  } as unknown as EntityDefinition;

  it('reads the parent and fills from the picked row', async () => {
    state.meta = visitWithSlot;
    state.options = [{ _id: 'G-1::r2', display: 'Garage One · Bay 2' }];
    const read = vi.fn((entity: string, name: string) =>
      entity === 'Garage' && name === 'G-1'
        ? Promise.resolve({
            success: true,
            status_code: 200,
            data: { _id: 'G-1', bays: [{ _row_id: 'r1', bay: 'B1' }, { _row_id: 'r2', bay: 'B2' }] },
            messages: [],
          })
        : Promise.reject(new ApiClientError(`${entity} ${name} not found`, 404)),
    );
    state.getDoc = read;

    const slot = await pick('slot');

    await waitFor(() => expect(comboboxValue('bay')).toBe('B2'));
    expect(read).toHaveBeenCalledWith('Garage', 'G-1');
    expect(within(slot).queryByText(/could not be filled/)).toBeNull();
  });

  it('says at the Link that the picked row is gone when the parent no longer holds it', async () => {
    state.meta = visitWithSlot;
    state.options = [{ _id: 'G-1::r3', display: 'Garage One · Bay 3' }];
    state.getDoc = () =>
      Promise.resolve({ success: true, status_code: 200, data: { _id: 'G-1', bays: [{ _row_id: 'r1', bay: 'B1' }] }, messages: [] });

    const slot = await pick('slot');

    expect(
      await within(slot).findByText('Bay could not be filled from this record: The picked row no longer exists'),
    ).toBeVisible();
    expect(comboboxValue('bay')).toBe('');
  });
});
