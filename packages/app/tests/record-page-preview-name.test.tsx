// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';

// The edit of a saved record previews through the route that names it, so the engine re-derives
// against the stored record as the save will; a new record previews as a draft.
const state = vi.hoisted(() => ({
  params: {} as { entity: string; name?: string },
  meta: {} as EntityDefinition,
  loaded: undefined as Record<string, unknown> | undefined,
  roles: ['Clerk'] as string[],
  previewOptions: [] as Array<{ enabled?: boolean; name?: string } | undefined>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => state.params,
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ state: 'unblocked' }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: state.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useDocument', () => ({
  useDocument: (entity?: string) => ({ data: entity ? state.loaded : undefined, isLoading: false, isError: false }),
  useSingle: (entity?: string) => ({ data: entity ? state.loaded : undefined, isLoading: false, isError: false }),
  useCreate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDoc: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCopy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// The options the page hands the preview: the saved record's name decides the engine's route.
vi.mock('@/hooks/usePreview', () => ({
  usePreview: (_entity: string, opts?: { enabled?: boolean; name?: string }) => {
    state.previewOptions.push(opts);
    return { data: undefined, status: 'idle', trigger: vi.fn() };
  },
}));
vi.mock('@/services/resource', () => ({ getDoc: vi.fn(), getSingle: vi.fn() }));
vi.mock('@/components/render/FormRenderer', () => ({ FormRenderer: () => <div data-testid="form-fields" /> }));
vi.mock('@/components/workflow/WorkflowBar', () => ({ WorkflowBar: () => null }));
vi.mock('@/components/workflow/ActionBar', () => ({ ActionBar: () => null }));
vi.mock('@/components/workflow/PrintMenu', () => ({ PrintMenu: () => null }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn().mockResolvedValue(true), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { _id: 'u1', email: 'tom@example.com', roles: state.roles } }),
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

function renderRecord(params: { entity: string; name?: string }) {
  state.params = params;
  state.previewOptions = [];
  state.meta = {
    name: params.entity,
    label: params.entity,
    title_field: '_id',
    fields: [{ fieldname: 'lines', fieldtype: 'Table', label: 'Lines', child_fields: [{ fieldname: 'item', fieldtype: 'Data', label: 'Item' }] }],
    permissions: [{ role: 'Clerk', level: 0, select: 1, read: 1, write: 1, create: 1 }],
  } as unknown as EntityDefinition;
  state.loaded = { _id: params.name, modified: 'T1', docstatus: 0, lines: [] };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('the preview of a record form', () => {
  it("names the saved record it edits", () => {
    renderRecord({ entity: 'Order', name: 'SO-1' });
    expect(state.previewOptions.at(-1)).toEqual({ enabled: true, name: 'SO-1' });
  });

  it('names no record for a new one', () => {
    renderRecord({ entity: 'Order' });
    expect(state.previewOptions.at(-1)).toEqual({ enabled: true, name: undefined });
  });
});
