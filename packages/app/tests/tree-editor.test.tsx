// @vitest-environment jsdom
// The Groups page's tree editor: which nodes are open, across a new mount of the page, for a node
// that arrives later and after an edit that puts a node under a group; and how a node is moved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';

// Siblings sort by position: the tests' keyboard starts on Retail, the first root.
const ROWS = [
  { _id: 'G-1', label: 'Retail', parent: null, position: 1 },
  { _id: 'G-2', label: 'Swiss', parent: 'G-1', position: 1 },
  { _id: 'G-3', label: 'Wholesale', parent: null, position: 2 },
  { _id: 'G-4', label: 'Germany', parent: 'G-3', position: 1 },
  { _id: 'G-5', label: 'Online', parent: null, position: 3 },
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
const dialogSeed = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));
vi.mock('@/components/record/RecordDialog', () => ({
  RecordDialog: (props: { seed?: Record<string, unknown> }) => {
    dialogSeed.current = props.seed;
    return null;
  },
}));

import { EntityTreeEditor } from '@/components/render/EntityTreeEditor';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { updateDoc } from '@/services/resource';
import { useUiStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';

const META = { name: 'CustomerGroup', title_field: 'name', fields: [] } as unknown as EntityDefinition;
const TREE: TreeConfig = {};

function Editor({ qc, tree = TREE, meta = META }: { qc: QueryClient; tree?: TreeConfig; meta?: EntityDefinition }) {
  return (
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <EntityTreeEditor entity="CustomerGroup" meta={meta} tree={tree} />
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
  // The entity withholds its permission matrix, so a signed-in person is offered every action.
  useSessionStore.setState({ user: { _id: 'u', email: 'u@demo.test', roles: ['System User'] } });
  vi.mocked(updateDoc).mockClear();
});

describe('EntityTreeEditor open groups', () => {
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
      { _id: 'G-6', label: 'Export', parent: null },
      { _id: 'G-7', label: 'Asia', parent: 'G-6' },
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

describe('EntityTreeEditor moving a node', () => {
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

describe('EntityTreeEditor kinds', () => {
  it('lists the kinds the rows carry, and opens the record of a new kind\'s first node with that kind', async () => {
    listState.rows = [
      { _id: 'G-1', label: 'Retail', parent: null, kind: 'Customers' },
      { _id: 'S-1', label: 'Wholesalers', parent: null, kind: 'Suppliers' },
    ];
    dialogSeed.current = undefined;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Editor qc={qc} tree={{ kind: true }} />);
    const user = userEvent.setup();
    expect(screen.getByText('Retail')).toBeInTheDocument();
    expect(screen.queryByText('Wholesalers')).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ ui.tree.newKind' }));
    await user.type(screen.getByRole('textbox', { name: 'ui.tree.kindName' }), 'Partners');
    await user.click(screen.getByRole('button', { name: 'ui.action.create' }));
    expect(dialogSeed.current).toEqual({ kind: 'Partners' });
  });
});

describe('EntityTreeEditor icons and pictures', () => {
  const renderWith = (meta: EntityDefinition) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Editor qc={qc} meta={meta} />);
  };

  it("draws a node's icon by its lucide name", () => {
    listState.rows = [{ _id: 'G-1', label: 'Retail', parent: null, icon: 'shopping-cart' }];
    renderWith(META);
    expect(row('G-1').querySelector('svg.lucide-shopping-cart')).not.toBeNull();
  });

  it("draws the picture of the entity's image_field, at the size of a row", () => {
    listState.rows = [{ _id: 'G-1', label: 'Retail', parent: null, photo: '/api/v1/public/file/f1' }];
    renderWith({ ...META, image_field: 'photo' } as EntityDefinition);
    expect(row('G-1').querySelector('img')?.getAttribute('src')).toBe('/api/v1/public/file/f1?thumb=1');
  });

  it('PLANTED INNOCENT: draws no picture for an entity that names no image_field', () => {
    listState.rows = [{ _id: 'G-1', label: 'Retail', parent: null, photo: '/api/v1/public/file/f1' }];
    renderWith(META);
    expect(row('G-1').querySelector('img')).toBeNull();
  });
});
