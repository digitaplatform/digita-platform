// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

/**
 * A new record opens with every magic-token default expanded, as the engine expands
 * it on insert: the engine keeps any non-empty value it receives, so a token the form
 * seeds as text is saved as text. An `eval:` default stays unset, so the engine
 * evaluates it on insert against the document it saves.
 */

const state = vi.hoisted(() => ({ meta: {} as EntityDefinition, doc: {} as Record<string, unknown> }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ entity: 'Loan' }),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: () => ({ data: undefined, isLoading: false, isError: false }),
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
vi.mock('@/components/render/FormRenderer', () => ({
  FormRenderer: ({ doc }: { doc: Record<string, unknown> }) => {
    state.doc = doc;
    return null;
  },
}));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: Record<string, unknown> }) => unknown) =>
    sel({ user: { _id: 'u1', email: 'ann@example.com', full_name: 'Ann Lee', roles: ['Administrator'] } }),
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

afterEach(cleanup);

describe('RecordPage seeds a new record with expanded defaults', () => {
  it('expands __user__, __username__, __now__ and __today__, and leaves an eval: default unset', () => {
    state.meta = {
      name: 'Loan',
      label: 'Loan',
      title_field: '_id',
      permissions: [],
      fields: [
        { fieldname: 'lent_by', fieldtype: 'Data', label: 'Lent by', default: '__user__' },
        { fieldname: 'lent_by_name', fieldtype: 'Data', label: 'Lent by name', default: '__username__' },
        { fieldname: 'lent_at', fieldtype: 'Datetime', label: 'Lent at', default: '__now__' },
        { fieldname: 'lent_on', fieldtype: 'Date', label: 'Lent on', default: '__today__' },
        { fieldname: 'days', fieldtype: 'Int', label: 'Days', default: 14 },
        { fieldname: 'due_note', fieldtype: 'Data', label: 'Due note', default: 'eval:doc.days * 2' },
      ],
    } as unknown as EntityDefinition;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <RecordPage />
      </QueryClientProvider>,
    );

    expect(state.doc['lent_by']).toBe('ann@example.com');
    expect(state.doc['lent_by_name']).toBe('Ann Lee');
    expect(Number.isNaN(Date.parse(String(state.doc['lent_at'])))).toBe(false);
    expect(state.doc['lent_on']).toBe(new Date().toISOString().slice(0, 10));
    expect(state.doc['days']).toBe(14);
    expect(state.doc['due_note']).toBeUndefined();
  });
});
