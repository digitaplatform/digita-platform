// @vitest-environment jsdom
// The tree view offers a new node, a move and a delete only to a role that may do it, as the
// list offers its New button: a read-only person met buttons the engine then refused.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';

const list = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/hooks/useList', () => ({
  useList: () => ({ data: { rows: list.rows }, isLoading: false, isError: false }),
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
    { role: 'Creator', level: 0, select: 1, read: 1, create: 1 },
    { role: 'Writer', level: 0, select: 1, read: 1, write: 1 },
    { role: 'Deleter', level: 0, select: 1, read: 1, delete: 1 },
    { role: 'Owner', level: 0, select: 1, read: 1, write: 1, delete: 1, if_owner: true },
  ],
} as unknown as EntityDefinition;
const TREE: TreeConfig = {};

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
  list.rows = [{ _id: 'G-1', label: 'Retail', parent: null }];
});

describe('the actions of the tree view', () => {
  it('offers no new node, move or delete to a role that may only read', () => {
    renderAs(['Demo']);
    expect(screen.getByText('Retail')).toBeInTheDocument();
    for (const entry of ENTRIES) expect(screen.queryByText(entry, { exact: false }) ?? screen.queryByLabelText(entry)).toBeNull();
  });

  // Each right opens its own entries only: a gate that asks the wrong right shows up in one row.
  const shown = () => ENTRIES.filter((entry) => (screen.queryByText(entry, { exact: false }) ?? screen.queryByLabelText(entry)) !== null);

  it.each([
    ['Creator', ['ui.tree.addRoot', 'ui.tree.addChild']],
    ['Writer', ['ui.tree.move']],
    ['Deleter', ['ui.action.delete']],
  ])('offers a role with one right, %s, only the entries of that right', (role, expected) => {
    renderAs([role]);
    expect(shown()).toEqual(expected);
  });

  it('offers each of them to a role that may create, write and delete', () => {
    renderAs(['Sales Manager']);
    expect(screen.getByText('ui.tree.addRoot', { exact: false })).toBeInTheDocument();
    for (const entry of ENTRIES.slice(1)) expect(screen.getByLabelText(entry)).toBeInTheDocument();
  });

  // A role whose write and delete rows are if_owner may move and delete its own nodes only: the
  // engine refuses the rest, so the tree offers them per node.
  it('offers a move and a delete on the own node only, to a role whose rows are if_owner', () => {
    list.rows = [
      { _id: 'G-1', label: 'Mine', parent: null, owner: 'u@demo.test' },
      { _id: 'G-2', label: 'Theirs', parent: null, owner: 'other@demo.test' },
    ];
    renderAs(['Owner']);
    const entriesOf = (label: string) => {
      const row = screen.getByText(label).closest('[data-tree-id]') as HTMLElement;
      return ['ui.tree.move', 'ui.action.delete'].filter((entry) => row.querySelector(`[aria-label="${entry}"]`) !== null);
    };
    expect(entriesOf('Mine')).toEqual(['ui.tree.move', 'ui.action.delete']);
    expect(entriesOf('Theirs')).toEqual([]);
  });
});
