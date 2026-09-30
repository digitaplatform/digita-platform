// @vitest-environment jsdom
// The Groups page's tree editor: which groups are open, across a new mount of the page and after
// an edit that puts a node under a group.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';

vi.mock('@/hooks/useList', () => ({
  useList: () => ({
    data: {
      rows: [
        { _id: 'G-1', name: 'Retail', parent: null },
        { _id: 'G-2', name: 'Swiss', parent: 'G-1' },
        { _id: 'G-3', name: 'Wholesale', parent: null },
        { _id: 'G-4', name: 'Germany', parent: 'G-3' },
        { _id: 'G-5', name: 'Online', parent: null },
      ],
    },
    isLoading: false,
    isError: false,
  }),
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
import { useUiStore } from '@/stores/ui';

const META = { name: 'CustomerGroup', title_field: 'name', fields: [] } as unknown as EntityDefinition;
const TREE: TreeConfig = { parent_field: 'parent', label_field: 'name' };

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <TreeEditor entity="CustomerGroup" meta={META} tree={TREE} />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
}

const row = (id: string) => document.querySelector(`[data-tree-id="${id}"]`) as HTMLElement;
const tree = () => screen.getByRole('tree');

beforeEach(() => {
  useUiStore.setState({ treeExpandedIds: {} });
});

describe('TreeEditor open groups', () => {
  it('starts collapsed and keeps the groups a person opened when the page opens again', () => {
    const first = renderEditor();
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Swiss')).toBeNull();
    fireEvent.keyDown(tree(), { key: 'ArrowRight' });
    expect(screen.getByText('Swiss')).toBeInTheDocument();
    first.unmount();

    renderEditor();
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Swiss')).toBeInTheDocument();
    expect(row('G-3')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the group a child is added to, so the new child shows', async () => {
    const user = userEvent.setup();
    renderEditor();
    // Retail closed, whatever the start: Left closes an open group and leaves a closed one.
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(row('G-1')).getByRole('button', { name: 'ui.tree.addChild' }));
    expect(row('G-1')).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the group a node is moved into, so the moved node shows', async () => {
    const user = userEvent.setup();
    renderEditor();
    // Wholesale closed, whatever the start: its name makes it the active row.
    await user.click(screen.getByRole('button', { name: 'Wholesale' }));
    fireEvent.keyDown(tree(), { key: 'ArrowLeft' });
    expect(row('G-3')).toHaveAttribute('aria-expanded', 'false');
    await user.click(within(row('G-5')).getByRole('button', { name: 'ui.tree.move' }));
    await user.click(screen.getByRole('button', { name: 'Wholesale' }));
    await waitFor(() => expect(row('G-3')).toHaveAttribute('aria-expanded', 'true'));
  });
});
