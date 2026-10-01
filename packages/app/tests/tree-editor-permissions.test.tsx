// @vitest-environment jsdom
// The tree view offers a new node, a move and a delete only to a role that may do it, as the
// list offers its New button: a read-only person met buttons the engine then refused.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';

vi.mock('@/hooks/useList', () => ({
  useList: () => ({ data: { rows: [{ _id: 'G-1', name: 'Retail', parent: null }] }, isLoading: false, isError: false }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));
vi.mock('@/services/resource', () => ({
  updateDoc: vi.fn(async () => ({})),
  deleteDoc: vi.fn(async () => ({})),
}));
vi.mock('@/components/record/RecordDialog', () => ({
  RecordDialog: () => null,
}));

import { TreeEditor } from '@/components/render/TreeEditor';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore } from '@/stores/session';

const META = {
  name: 'CustomerGroup',
  title_field: 'name',
  fields: [],
  permissions: [
    { role: 'Demo', level: 0, select: 1, read: 1 },
    { role: 'Sales Manager', level: 0, select: 1, read: 1, create: 1, write: 1, delete: 1 },
  ],
} as unknown as EntityDefinition;
const TREE: TreeConfig = { parent_field: 'parent', label_field: 'name' };

function renderAs(roles: string[]) {
  useSessionStore.setState({ user: { _id: 'u', email: 'u@demo.test', roles } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <TreeEditor entity="CustomerGroup" meta={META} tree={TREE} />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
}

const ENTRIES = ['ui.tree.addRoot', 'ui.tree.addChild', 'ui.tree.move', 'ui.action.delete'];

beforeEach(() => {
  useSessionStore.setState({ user: null });
});

describe('the actions of the tree view', () => {
  it('offers no new node, move or delete to a role that may only read', () => {
    renderAs(['Demo']);
    expect(screen.getByText('Retail')).toBeInTheDocument();
    for (const entry of ENTRIES) expect(screen.queryByText(entry, { exact: false }) ?? screen.queryByLabelText(entry)).toBeNull();
  });

  it('offers each of them to a role that may create, write and delete', () => {
    renderAs(['Sales Manager']);
    expect(screen.getByText('ui.tree.addRoot', { exact: false })).toBeInTheDocument();
    for (const entry of ENTRIES.slice(1)) expect(screen.getByLabelText(entry)).toBeInTheDocument();
  });
});
