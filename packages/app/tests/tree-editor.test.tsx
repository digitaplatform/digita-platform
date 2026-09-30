// @vitest-environment jsdom
// The Groups page's tree editor: which nodes are open, across a new mount of the page, for a node
// that arrives later and after an edit that puts a node under a group; and how a node is moved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';

const ROWS = [
  { _id: 'G-1', name: 'Retail', parent: null },
  { _id: 'G-2', name: 'Swiss', parent: 'G-1' },
  { _id: 'G-3', name: 'Wholesale', parent: null },
  { _id: 'G-4', name: 'Germany', parent: 'G-3' },
  { _id: 'G-5', name: 'Online', parent: null },
];
const listState = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('@/hooks/useList', () => ({
  useList: () => ({ data: { rows: listState.rows }, isLoading: false, isError: false }),
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
import { updateDoc } from '@/services/resource';
import { useUiStore } from '@/stores/ui';

const META = { name: 'CustomerGroup', title_field: 'name', fields: [] } as unknown as EntityDefinition;
const TREE: TreeConfig = { parent_field: 'parent', label_field: 'name' };

function Editor({ qc }: { qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <TreeEditor entity="CustomerGroup" meta={META} tree={TREE} />
      </DialogHostProvider>
    </QueryClientProvider>
  );
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<Editor qc={qc} />);
  // Renders the page again with the rows of `listState`, as a refetch does.
  return { ...view, refresh: () => view.rerender(<Editor qc={qc} />) };
}

const row = (id: string) => document.querySelector(`[data-tree-id="${id}"]`) as HTMLElement;
const tree = () => screen.getByRole('tree');

beforeEach(() => {
  listState.rows = ROWS;
  useUiStore.setState({ treeEditorCollapsedIds: {} });
  vi.mocked(updateDoc).mockClear();
});

describe('TreeEditor open groups', () => {
  it('starts with every group open and keeps the groups a person closed when the page opens again', () => {
    const first = renderEditor();
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'true');
    expect(row('G-3')).toHaveAttribute('aria-expanded', 'true');
    // Left closes the first row, Retail.
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(screen.queryByText('Swiss')).toBeNull();
    first.unmount();

    renderEditor();
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Swiss')).toBeNull();
    expect(row('G-3')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Germany')).toBeInTheDocument();
  });

  it('opens a group that arrives after the page opened, like the groups that were there', () => {
    const view = renderEditor();
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    listState.rows = [
      ...ROWS,
      { _id: 'G-6', name: 'Export', parent: null },
      { _id: 'G-7', name: 'Asia', parent: 'G-6' },
    ];
    view.refresh();
    expect(row('G-6')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Asia')).toBeInTheDocument();
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the group a child is added to, so the new child shows', async () => {
    const user = userEvent.setup();
    renderEditor();
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(row('G-1')).getByRole('button', { name: 'ui.tree.addChild' }));
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('TreeEditor moving a node', () => {
  it('opens a group on its name and moves the node through the Select button in its row', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(row('G-5')).getByRole('button', { name: 'ui.tree.move' }));
    await user.click(screen.getByRole('button', { name: 'Wholesale' }));
    expect(row('G-3')).toHaveAttribute('aria-expanded', 'false');
    expect(updateDoc).not.toHaveBeenCalled();
    await user.click(within(row('G-3')).getByRole('button', { name: 'ui.tree.select Wholesale' }));
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith('CustomerGroup', 'G-5', { parent: 'G-3' }, undefined),
    );
    // The group the node moved into opens, so the moved node shows.
    await waitFor(() => expect(row('G-3')).toHaveAttribute('aria-expanded', 'true'));
  });

  it('keeps the moving node and its subtree unpickable, and moves it onto a leaf by its name', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(within(row('G-1')).getByRole('button', { name: 'ui.tree.move' }));
    expect(within(row('G-1')).getByRole('button', { name: 'ui.tree.select Retail' })).toBeDisabled();
    expect(within(row('G-3')).getByRole('button', { name: 'ui.tree.select Wholesale' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Swiss' }));
    expect(updateDoc).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Online' }));
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith('CustomerGroup', 'G-1', { parent: 'G-5' }, undefined),
    );
  });
});
