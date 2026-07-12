// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * Wave 2 of the read-only-submitted parity (docs/plans/2026-07-09-ui-readonly-submitted.md):
 * a submittable doc that the engine has frozen (docstatus 1 submitted / 2 cancelled) must
 * NOT offer Save, must show the read-only lock badge, and must gate Delete the same way the
 * engine does — no Delete on a standing submitted doc (cancel it first), Delete allowed once
 * cancelled. A non-submittable entity, and a submittable draft (docstatus 0), stay fully
 * editable. The field-level lock (every control read-only) is covered in evaluate-field.test.ts;
 * this asserts the page-chrome affordances (Save / Delete / badge).
 */

const state = vi.hoisted(() => ({
  meta: {} as EntityDefinition,
  loaded: {} as Record<string, unknown>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Invoice', name: 'INV-1' }),
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
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) =>
    sel({ user: { roles: ['Administrator'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (
    sel: (s: { t: (k: string) => string; tEntity: (e: string, fb?: string) => string }) => unknown,
  ) => sel({ t: (k: string) => k, tEntity: (e: string, fb?: string) => fb ?? e }),
}));
vi.mock('@/stores/record-title', () => ({
  useRecordTitle: (sel: (s: { publish: () => void; clear: () => void }) => unknown) =>
    sel({ publish: vi.fn(), clear: vi.fn() }),
}));

import RecordPage from '@/pages/RecordPage';

function makeMeta(is_submittable: boolean): EntityDefinition {
  return {
    name: 'Invoice',
    label: 'Invoice',
    title_field: '_id',
    fields: [{ fieldname: 'note', fieldtype: 'Data', label: 'Note' }],
    permissions: [],
    is_submittable,
  } as unknown as EntityDefinition;
}

function renderPage(is_submittable: boolean, docstatus: number) {
  state.meta = makeMeta(is_submittable);
  state.loaded = { _id: 'INV-1', modified: 'T1', docstatus, note: 'a' };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.meta = makeMeta(false);
  state.loaded = {};
});
afterEach(cleanup);

describe('RecordPage read-only on a submitted/cancelled submittable doc', () => {
  it('submittable + docstatus 1 (submitted): no Save, read-only badge, no Delete', () => {
    const { queryByRole, getByTestId } = renderPage(true, 1);
    expect(queryByRole('button', { name: 'ui.action.save' })).toBeNull();
    expect(queryByRole('button', { name: 'ui.action.delete' })).toBeNull();
    const badge = getByTestId('docstatus-badge');
    expect(badge.textContent).toContain('ui.record.readonlySubmitted');
  });

  it('submittable + docstatus 2 (cancelled): no Save, cancelled badge, Delete allowed', () => {
    const { queryByRole, getByTestId } = renderPage(true, 2);
    expect(queryByRole('button', { name: 'ui.action.save' })).toBeNull();
    expect(queryByRole('button', { name: 'ui.action.delete' })).not.toBeNull();
    expect(getByTestId('docstatus-badge').textContent).toContain('ui.record.readonlyCancelled');
  });

  it('submittable draft (docstatus 0): Save shown, no lock badge', () => {
    const { queryByRole, queryByTestId } = renderPage(true, 0);
    expect(queryByRole('button', { name: 'ui.action.save' })).not.toBeNull();
    expect(queryByTestId('docstatus-badge')).toBeNull();
  });

  it('non-submittable entity at docstatus 1: fully editable — Save shown, no badge', () => {
    const { queryByRole, queryByTestId } = renderPage(false, 1);
    expect(queryByRole('button', { name: 'ui.action.save' })).not.toBeNull();
    expect(queryByTestId('docstatus-badge')).toBeNull();
  });
});
