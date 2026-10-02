// @vitest-environment jsdom
// A workshop's first Administrator opens the app. Its settings record came from a seed and lacks
// the street and the hourly rate, so the engine refuses every new record. The setup page asks for
// exactly those fields in the settings record's own form and saves them as that record's page would.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';

const updateMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const singleMock = vi.hoisted(() => vi.fn());

const META = {
  name: 'WorkshopSetting',
  label: 'Workshop settings',
  title_field: 'company_name',
  is_single: true,
  form: { layout: 'tabbed', min_tab_fields: 1 },
  fields: [
    { fieldname: 'sec_company', fieldtype: 'SectionBreak', label: 'Company' },
    { fieldname: 'company_name', fieldtype: 'Data', label: 'Company name', required: true },
    { fieldname: 'street', fieldtype: 'Data', label: 'Street', required: true },
    { fieldname: 'sec_invoicing', fieldtype: 'SectionBreak', label: 'Invoicing' },
    { fieldname: 'hourly_rate', fieldtype: 'Data', label: 'Hourly rate', required: true },
    { fieldname: 'sec_texts', fieldtype: 'SectionBreak', label: 'Texts' },
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
    // A record page shows a bold amount above the form.
    { fieldname: 'credit', fieldtype: 'Currency', label: 'Credit', bold: true },
  ],
  links: [{ entity: 'Order', field: 'workshop' }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

const STORED = { _id: 'workshop', modified: 'T1', docstatus: 0, company_name: 'Workshop', credit: 5 };

/** A second settings record of the app, whose stored BIC its pattern refuses. */
const BANK_META = {
  name: 'BankSetting',
  label: 'Bank settings',
  is_single: true,
  fields: [{ fieldname: 'bic', fieldtype: 'Data', label: 'BIC', required: true }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

const BANK_STORED = { _id: 'bank', modified: 'T9', docstatus: 0, bic: 'not a bic' };

vi.mock('@/hooks/useMeta', () => ({
  useMeta: (entity: string) => ({ data: entity === 'BankSetting' ? BANK_META : META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
  useSingle: singleMock,
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: updateMock, isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => <p>workflow bar</p> }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => <p>action bar</p> }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => <p>print menu</p> }));
vi.mock('@/components/record/HistoryPanel', () => ({ HistoryPanel: () => <p>history panel</p> }));
vi.mock('@/components/record/LinksPanel', () => ({ LinksPanel: () => <p>links panel</p> }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: confirmMock, toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (k: string, params?: Record<string, string>) => (params ? `${k} ${JSON.stringify(params)}` : k),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (
    sel: (s: {
      t: (k: string) => string;
      tEntity: (e: string, fb?: string) => string;
      tField: (e: string, f: string, fb?: string) => string;
      tOption: (e: string, f: string, o: string) => string;
    }) => unknown,
  ) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, f: string, fb?: string) => fb ?? f,
      tOption: (_e: string, _f: string, o: string) => o,
    }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import { useSessionStore } from '@/stores/session';
import SetupPage from '@/pages/SetupPage';

const PENDING = { entity: 'WorkshopSetting', fields: ['street', 'hourly_rate'], missing_record: false };

function openSetupPage() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>start page</p> },
      { path: '/_setup', element: <SetupPage /> },
    ],
    { initialEntries: ['/_setup'] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const fieldOf = (fieldname: string) => screen.queryByTestId(`field:WorkshopSetting:${fieldname}`);
/** The text input of a field; a control is loaded when its field is first drawn. */
const inputOf = async (fieldname: string, entity = 'WorkshopSetting') =>
  within(await screen.findByTestId(`field:${entity}:${fieldname}`)).findByRole('textbox');

beforeEach(() => {
  singleMock.mockImplementation((entity?: string) => ({
    data: entity === 'BankSetting' ? BANK_STORED : STORED,
    isLoading: false,
    isError: false,
  }));
  useSessionStore.setState({
    status: 'authenticated',
    user: { _id: 'a', email: 'admin@digita.local', full_name: 'Admin', roles: ['Administrator'] } as never,
    setup: { complete: false, records: [PENDING] },
  });
});

afterEach(() => {
  cleanup();
  updateMock.mockReset();
  confirmMock.mockClear();
  singleMock.mockClear();
});

describe('the setup page', () => {
  it('asks for exactly the open fields, each under its section of the settings form', async () => {
    openSetupPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'ui.setup.title' })).toBeInTheDocument();
    expect(screen.getByText('ui.setup.intro')).toBeInTheDocument();
    expect(fieldOf('street')).toBeInTheDocument();
    expect(fieldOf('hourly_rate')).toBeInTheDocument();
    expect(fieldOf('company_name')).not.toBeInTheDocument();
    expect(fieldOf('note')).not.toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Invoicing')).toBeInTheDocument();
    expect(screen.queryByText('Texts')).not.toBeInTheDocument();
    // One page: the settings form's tabs are for its full length.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it("draws none of the record page's own chrome", async () => {
    openSetupPage();
    await screen.findByRole('heading', { level: 1, name: 'ui.setup.title' });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    for (const chrome of ['print menu', 'action bar', 'workflow bar', 'history panel', 'links panel', 'Credit']) {
      expect(screen.queryByText(chrome)).not.toBeInTheDocument();
    }
  });

  it("saves through the settings record's own update", async () => {
    updateMock.mockResolvedValue({ ...STORED, street: 'Main Street 1', hourly_rate: '120', modified: 'T2' });
    openSetupPage();

    await userEvent.type(await inputOf('street'), 'Main Street 1');
    await userEvent.type(await inputOf('hourly_rate'), '120');
    await userEvent.click(screen.getByRole('button', { name: 'ui.action.save' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0]![0]).toMatchObject({
      name: 'workshop',
      expectedModified: 'T1',
      body: { company_name: 'Workshop', street: 'Main Street 1', hourly_rate: '120' },
    });
  });

  it('refuses a save that leaves an open field empty, as the record page does', async () => {
    openSetupPage();

    await userEvent.type(await inputOf('street'), 'Main Street 1');
    const hourlyRate = await inputOf('hourly_rate');
    await userEvent.click(screen.getByRole('button', { name: 'ui.action.save' }));

    await waitFor(() => expect(hourlyRate).toBeInvalid());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('opens the start page once the setup is complete', async () => {
    const router = openSetupPage();
    await screen.findByRole('heading', { level: 1, name: 'ui.setup.title' });

    useSessionStore.setState({ setup: { complete: true, records: [] } });

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('goes on to the next record the setup still needs, with that record\'s stored values', async () => {
    openSetupPage();
    await userEvent.type(await inputOf('street'), 'Main Street 1');

    // The save completed the workshop's settings; the bank's are still open.
    useSessionStore.setState({
      setup: { complete: false, records: [{ entity: 'BankSetting', fields: ['bic'], missing_record: false }] },
    });

    expect(await inputOf('bic', 'BankSetting')).toHaveValue('not a bic');
    expect(fieldOf('street')).not.toBeInTheDocument();
  });

  it('shows a field the save refuses although the engine did not name it, and keeps it while it is edited', async () => {
    // The hourly rate is required and empty, but only the street is named.
    useSessionStore.setState({
      setup: { complete: false, records: [{ entity: 'WorkshopSetting', fields: ['street'], missing_record: false }] },
    });
    openSetupPage();
    await userEvent.type(await inputOf('street'), 'Main Street 1');
    expect(fieldOf('hourly_rate')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ui.action.save' }));

    const hourlyRate = await inputOf('hourly_rate');
    expect(hourlyRate).toBeInvalid();
    await userEvent.type(hourlyRate, '120');
    expect(hourlyRate).toBeValid();
    expect(fieldOf('hourly_rate')).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('leaves for the start page on Cancel', async () => {
    const router = openSetupPage();

    await userEvent.click(await screen.findByRole('button', { name: 'ui.action.cancel' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('says why there is no form where the settings record does not exist', async () => {
    singleMock.mockImplementation(() => ({ data: undefined, isLoading: false, isError: true, error: new Error('404') }));
    useSessionStore.setState({ setup: { complete: false, records: [{ ...PENDING, missing_record: true }] } });
    openSetupPage();

    expect(await screen.findByText('ui.setup.recordMissing {"entity":"Workshop settings"}')).toBeInTheDocument();
    // No read of a record that is known not to exist.
    expect(singleMock).not.toHaveBeenCalledWith('WorkshopSetting');
    expect(fieldOf('street')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ui.action.save' })).not.toBeInTheDocument();
  });

  it('sends a user who can fill nothing to the start page, where the notice stands', async () => {
    useSessionStore.setState({ setup: { complete: false, records: [] } });
    const router = openSetupPage();

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
