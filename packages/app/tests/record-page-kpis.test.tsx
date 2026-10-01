// @vitest-environment jsdom
// The KPI band above a record shows its money amounts as a bill does: with the fraction
// digits of the currency, or two when no currency is known, unless the field sets its own.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Invoice', name: 'INV-1' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({
    data: { _id: 'INV-1', modified: 'T1', docstatus: 0, grand_total: 440.9, rate: 1.5 },
    isLoading: false,
    isError: false,
  }),
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
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { roles: ['Administrator'] }, locale: { code: 'en', format_locale: 'en' }, settings: { default_currency: null } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: unknown) => unknown) =>
    sel({
      t: (k: string) => k,
      tEntity: (e: string, fb?: string) => fb ?? e,
      tField: (_e: string, f: string, fb?: string) => fb ?? f,
    }),
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
  fields: [
    { fieldname: 'grand_total', fieldtype: 'Currency', label: 'Grand total', bold: true },
    { fieldname: 'rate', fieldtype: 'Currency', label: 'Rate', bold: true, precision: 3 },
  ],
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

function figureOf(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

describe('RecordPage KPI band', () => {
  it('shows an amount without a currency with two fraction digits', () => {
    renderPage();
    expect(figureOf('Grand total')).toBe('440.90');
  });

  it('keeps the precision of the field', () => {
    renderPage();
    expect(figureOf('Rate')).toBe('1.500');
  });
});
