// @vitest-environment jsdom
// The record page pins the form's tab strip under the header's bar, leads back to its list
// from the bar and keeps the record's actions under the title.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Invoice', name: 'INV-1' }),
  useNavigate: () => navigate,
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: { _id: 'INV-1', modified: 'T1', docstatus: 0, note: 'a' }, isLoading: false, isError: false }),
  useSingle: () => ({ data: undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/usePreview', () => ({
  usePreview: () => ({ data: undefined, status: 'idle', trigger: vi.fn() }),
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({
  FormRenderer: ({ tabsClassName }: { tabsClassName?: string }) => <div role="tablist" className={tabsClassName} />,
}));
vi.mock('@/components/workflow/PrintMenu', () => ({
  PrintMenu: () => <button type="button">Print</button>,
}));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: { t: (k: string) => string; tEntity: (e: string, fb?: string) => string }) => unknown) =>
    sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

const META = {
  name: 'Invoice',
  label: 'Invoice',
  label_plural: 'Invoices',
  title_field: '_id',
  fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
  permissions: [],
  is_submittable: false,
} as unknown as EntityDefinition;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

describe('RecordPage header', () => {
  it('pins the tab strip under the bar, by the height the header publishes', () => {
    renderPage();
    expect(screen.getByRole('tablist').className).toContain(
      'sticky top-[calc(var(--topbar-h,0px)_+_var(--page-header-bar-h,0px))]',
    );
  });

  it('leads back to the list, named as the list names itself', () => {
    renderPage();
    const back = screen.getByRole('button', { name: 'Invoices' });
    expect(document.querySelector('[data-ui="page-header-bar"]')).toContainElement(back);
    fireEvent.click(back);
    expect(navigate).toHaveBeenCalledWith('/Invoice');
  });

  it('draws the actions under the title, not in the bar', () => {
    renderPage();
    const print = screen.getByRole('button', { name: 'Print' });
    expect(document.querySelector('[data-ui="page-header-bar"]')).not.toContainElement(print);
    expect(document.querySelector('form')).toContainElement(print);
  });
});
