// The kit's tree editor on an entity that holds one tree per kind: it lists the kinds the nodes
// carry, shows one kind's tree, and "New kind" asks for a name and adds that kind's first node.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreeEditor, type TreeEditorLabels, type TreeEditorNode } from '../src/composites/TreeEditor.js';

const LABELS = Object.fromEntries(
  ['kind', 'newKind', 'kindName', 'create', 'addRoot', 'addChild', 'move', 'moveToRoot', 'movingHint', 'cancel', 'delete', 'search', 'noResults', 'select'].map(
    (k) => [k, k],
  ),
) as unknown as TreeEditorLabels;

const NODES: TreeEditorNode[] = [
  { id: 'A-1', label: 'Assets', parentId: null, kind: 'Accounts' },
  { id: 'C-1', label: 'Retail', parentId: null, kind: 'Customers' },
  { id: 'C-2', label: 'Swiss', parentId: 'C-1', kind: 'Customers' },
];

function renderEditor(nodes: TreeEditorNode[], onAdd = vi.fn()) {
  const view = render(
    <TreeEditor nodes={nodes} hasKinds canCreate labels={LABELS} onAdd={onAdd} onEdit={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />,
  );
  return { ...view, onAdd };
}

const offeredKinds = async () => {
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'kind' }));
  return screen.getAllByRole('option').map((o) => o.textContent);
};

describe('TreeEditor kinds', () => {
  it('lists the kinds the nodes carry and shows the tree of the first one only', async () => {
    renderEditor(NODES);
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.queryByText('Retail')).toBeNull();
    expect(await offeredKinds()).toEqual(['Accounts', 'Customers']);
  });

  it('shows the tree of the kind a person picks, and adds a root of that kind', async () => {
    const { onAdd } = renderEditor(NODES);
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'kind' }));
    await user.click(screen.getByRole('option', { name: 'Customers' }));
    expect(screen.getByText('Retail')).toBeInTheDocument();
    expect(screen.queryByText('Assets')).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ addRoot' }));
    expect(onAdd).toHaveBeenCalledWith({ parentId: null, kind: 'Customers', ancestry: [] });
  });

  it('asks for the name of a new kind and adds its first node as a root of that kind', async () => {
    const { onAdd, rerender } = renderEditor(NODES);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ newKind' }));
    await user.type(screen.getByRole('textbox', { name: 'kindName' }), '  Suppliers ');
    await user.click(screen.getByRole('button', { name: 'create' }));
    expect(onAdd).toHaveBeenCalledWith({ parentId: null, kind: 'Suppliers', ancestry: [] });
    // The new kind is chosen before its first node exists, and its node shows once the caller saved it.
    expect(screen.getByRole('combobox', { name: 'kind' })).toHaveTextContent('Suppliers');
    rerender(
      <TreeEditor
        nodes={[...NODES, { id: 'S-1', label: 'Wholesalers', parentId: null, kind: 'Suppliers' }]}
        hasKinds
        canCreate
        labels={LABELS}
        onAdd={onAdd}
        onEdit={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Wholesalers')).toBeInTheDocument();
    expect(screen.queryByText('Assets')).toBeNull();
  });

  it('offers only "New kind" while no node carries a kind, so no root goes in without one', () => {
    renderEditor([]);
    expect(screen.queryByRole('combobox', { name: 'kind' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ addRoot' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ newKind' })).toBeInTheDocument();
  });

  it('PLANTED INNOCENT: an entity without kinds shows every node and offers no kind list', () => {
    render(
      <TreeEditor nodes={NODES} canCreate labels={LABELS} onAdd={vi.fn()} onEdit={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Retail')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'kind' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ newKind' })).toBeNull();
  });
});
