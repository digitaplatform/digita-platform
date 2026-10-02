// @vitest-environment jsdom
// The search box above the Groups page's tree: a typed query filters the tree and shows each match
// with its ancestors open, clearing it brings back the groups a person had open, and the row
// actions work on the filtered tree as on the full one.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
const CUSTOMER_GROUP = vi.hoisted(() => ({
  name: 'CustomerGroup',
  title_field: 'name',
  fields: [],
  tree: {},
}));
vi.mock('@/hooks/useTreeEntities', () => ({
  useTreeEntities: () => ({
    entities: [{ entity: 'CustomerGroup', label: 'Customer groups', meta: CUSTOMER_GROUP }],
    isLoading: false,
  }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));
vi.mock('@/services/resource', () => ({
  updateDoc: vi.fn(async () => ({})),
  deleteDoc: vi.fn(async () => ({})),
}));
type RecordDialogProps = { name?: string; seed?: Record<string, unknown>; ancestry?: string[] };
const recordDialog = vi.hoisted(() => ({ props: null as RecordDialogProps | null }));
vi.mock('@/components/record/RecordDialog', () => ({
  RecordDialog: (props: RecordDialogProps) => {
    recordDialog.props = props;
    return null;
  },
}));

import GroupsPage from '@/pages/GroupsPage';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { deleteDoc, updateDoc } from '@/services/resource';
import { useUiStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <GroupsPage />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
}

const findRow = (id: string) => document.querySelector(`[data-tree-id="${id}"]`) as HTMLElement | null;
const findSearchBox = () => screen.getByRole('searchbox', { name: 'ui.list.search' });

beforeEach(() => {
  listState.rows = ROWS;
  recordDialog.props = null;
  useUiStore.setState({ treeEditorCollapsedIds: {} });
  // The entity withholds its permission matrix, so a signed-in person is offered every action.
  useSessionStore.setState({ user: { _id: 'u', email: 'u@demo.test', roles: ['System User'] } });
  vi.mocked(updateDoc).mockClear();
  vi.mocked(deleteDoc).mockClear();
});

describe('Groups page search', () => {
  it('filters its tree by a typed query and shows each match with its ancestors open', async () => {
    const user = userEvent.setup();
    renderPage();
    // A person closed Retail before searching.
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowLeft' });
    expect(screen.queryByText('Swiss')).toBeNull();
    await user.type(findSearchBox(), 'SWI');
    expect(screen.getByText('Swiss')).toBeInTheDocument();
    expect(findRow('G-1')).toHaveAttribute('aria-expanded', 'true');
    expect(findRow('G-3')).toBeNull();
    expect(findRow('G-4')).toBeNull();
    expect(findRow('G-5')).toBeNull();
  });

  it('brings back the groups a person had open when the search is cleared', async () => {
    const user = userEvent.setup();
    renderPage();
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowLeft' });
    await user.type(findSearchBox(), 'swi');
    await user.clear(findSearchBox());
    expect(findRow('G-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Swiss')).toBeNull();
    expect(findRow('G-3')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Germany')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('says that no group matches a query that finds none', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(findSearchBox(), 'zzz');
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    expect(screen.getByText('ui.select.noResults')).toBeInTheDocument();
  });
});

describe('Groups page row actions on a filtered tree', () => {
  it('adds a child under a match, with the path of the match', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(findSearchBox(), 'swi');
    await user.click(within(findRow('G-2')!).getByRole('button', { name: 'ui.tree.addChild' }));
    expect(recordDialog.props).toMatchObject({ seed: { parent: 'G-2' }, ancestry: ['Retail', 'Swiss'] });
  });

  it('opens a match on its name to rename it', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(findSearchBox(), 'swi');
    await user.click(screen.getByRole('button', { name: 'Swiss' }));
    expect(recordDialog.props).toMatchObject({ name: 'G-2', ancestry: ['Retail'] });
  });

  it('deletes a match after the confirm', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(findSearchBox(), 'ger');
    await user.click(within(findRow('G-4')!).getByRole('button', { name: 'ui.action.delete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'ui.action.delete' }));
    await waitFor(() => expect(deleteDoc).toHaveBeenCalledWith('CustomerGroup', 'G-4'));
  });

  it('refuses to delete a match whose children the search hides, as on the full tree', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(findSearchBox(), 'retail');
    expect(screen.queryByText('Swiss')).toBeNull();
    await user.click(within(findRow('G-1')!).getByRole('button', { name: 'ui.action.delete' }));
    expect(await screen.findByText('ui.tree.hasChildren')).toBeInTheDocument();
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it('moves a node onto a group the search found', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(findRow('G-5')!).getByRole('button', { name: 'ui.tree.move' }));
    await user.type(findSearchBox(), 'whole');
    await user.click(within(findRow('G-3')!).getByRole('button', { name: 'ui.tree.select Wholesale' }));
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith('CustomerGroup', 'G-5', { parent: 'G-3' }, undefined),
    );
  });
});
