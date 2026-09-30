import type { FormEvent } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
import { TreeView, type TreeViewNode } from '../src/composites/TreeView.js';

const nodes: TreeViewNode[] = [
  { id: 'src', label: 'Invoice', parentId: null },
  { id: 'f1', label: 'customer', parentId: 'src' },
  { id: 'f2', label: 'total', parentId: 'src' },
];

const row = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-tree-id="${id}"]`) as HTMLElement;

describe('TreeView drag source (getNodeDragData)', () => {
  it('is not draggable at all when the prop is absent (unchanged default)', () => {
    const { container } = render(<TreeView nodes={nodes} />);
    for (const id of ['src', 'f1', 'f2']) {
      expect(row(container, id)).not.toHaveAttribute('draggable');
    }
  });

  it('marks only nodes with a payload draggable and sets the dataTransfer on dragstart', () => {
    const { container } = render(
      <TreeView
        nodes={nodes}
        getNodeDragData={(n) =>
          n.parentId === null ? null : { type: 'application/x-digita-field', data: `{"path":"${n.label}"}` }
        }
      />,
    );
    // Group node returned null → not draggable; leaves are.
    expect(row(container, 'src')).not.toHaveAttribute('draggable');
    expect(row(container, 'f1')).toHaveAttribute('draggable', 'true');
    expect(row(container, 'f2')).toHaveAttribute('draggable', 'true');

    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(row(container, 'f1'), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-digita-field',
      '{"path":"customer"}',
    );
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('keeps selection, keyboard navigation and the filter working alongside drag', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TreeView
        nodes={nodes}
        onSelect={onSelect}
        getNodeDragData={(n) => (n.parentId ? { type: 'text/plain', data: n.id } : null)}
      />,
    );
    // Click-select still fires.
    fireEvent.click(screen.getByText('customer'));
    expect(onSelect).toHaveBeenCalledWith('f1');

    // Keyboard: the click made f1 the active row → ArrowDown moves to its
    // sibling f2, Enter selects it.
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('f2');
  });

  it('filter keeps matches + ancestors visible and matches stay draggable', () => {
    const { container } = render(
      <TreeView
        nodes={nodes}
        query="total"
        getNodeDragData={(n) => (n.parentId ? { type: 'text/plain', data: n.id } : null)}
      />,
    );
    expect(row(container, 'src')).toBeTruthy(); // ancestor stays visible
    expect(row(container, 'f2')).toBeTruthy(); // the match
    expect(row(container, 'f1')).toBeNull(); // non-match filtered out
    expect(row(container, 'f2')).toHaveAttribute('draggable', 'true');
  });
});

const groups: TreeViewNode[] = [
  { id: 'main', label: 'Main group', parentId: null },
  { id: 'sub', label: 'Sub group', parentId: 'main' },
  { id: 'leaf', label: 'Leaf', parentId: 'sub' },
];

const openIds = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="treeitem"][aria-expanded="true"]')].map((r) =>
    r.getAttribute('data-tree-id'),
  );

describe('TreeView open nodes', () => {
  it('opens the nodes that arrive after the mount like the ones present at it', () => {
    const late = render(<TreeView nodes={[]} />);
    late.rerender(<TreeView nodes={groups} />);
    const atMount = render(<TreeView nodes={groups} />);
    expect(openIds(atMount.container)).toEqual(['main', 'sub']);
    expect(openIds(late.container)).toEqual(openIds(atMount.container));
  });

  it('shows the open nodes it is given and reports a change instead of keeping it', () => {
    const onExpandedIdsChange = vi.fn();
    const { container, rerender } = render(
      <TreeView nodes={groups} expandedIds={new Set(['main'])} onExpandedIdsChange={onExpandedIdsChange} />,
    );
    expect(openIds(container)).toEqual(['main']);
    const tree = container.querySelector('[role="tree"]') as HTMLElement;
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowRight' });
    expect(onExpandedIdsChange).toHaveBeenCalledWith(new Set(['main', 'sub']));
    expect(screen.queryByText('Leaf')).toBeNull();
    rerender(
      <TreeView nodes={groups} expandedIds={new Set(['main', 'sub'])} onExpandedIdsChange={onExpandedIdsChange} />,
    );
    expect(screen.getByText('Leaf')).toBeInTheDocument();
  });
});

describe('TreeView with names that open groups (expandOnNameClick)', () => {
  it('opens and closes a group on its name and never selects it', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TreeView nodes={groups} onSelect={onSelect} expandOnNameClick selectLabel="Select" />,
    );
    const name = screen.getByRole('button', { name: 'Main group' });
    expect(row(container, 'main')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(name);
    expect(row(container, 'main')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sub group')).toBeNull();
    fireEvent.click(name);
    expect(row(container, 'main')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Sub group')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects a group through the Select button in its row, a leaf through its name', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TreeView nodes={groups} onSelect={onSelect} expandOnNameClick selectLabel="Select" />,
    );
    fireEvent.click(within(row(container, 'sub')).getByRole('button', { name: 'Select Sub group' }));
    expect(onSelect).toHaveBeenLastCalledWith('sub');
    expect(within(row(container, 'leaf')).queryByText('Select')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leaf' }));
    expect(onSelect).toHaveBeenLastCalledWith('leaf');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('makes a group the active row on its name, so Enter selects it from the keyboard', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TreeView nodes={groups} onSelect={onSelect} expandOnNameClick selectLabel="Select" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sub group' }));
    fireEvent.keyDown(container.querySelector('[role="tree"]') as HTMLElement, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('sub');
  });

  it('still opens a blocked group on its name, and disables its Select button', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TreeView
        nodes={groups}
        onSelect={onSelect}
        expandOnNameClick
        selectLabel="Select"
        disabledIds={new Set(['sub', 'leaf'])}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sub group' }));
    expect(row(container, 'sub')).toHaveAttribute('aria-expanded', 'false');
    expect(within(row(container, 'sub')).getByRole('button', { name: 'Select Sub group' })).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('names the Select button after its group and states the group once, on its treeitem', () => {
    render(<TreeView nodes={groups} expandOnNameClick selectLabel="Select" />);
    const main = screen.getByRole('treeitem', { name: 'Main group' });
    expect(main).toHaveAttribute('aria-expanded', 'true');
    expect(main.querySelectorAll('[aria-expanded]')).toHaveLength(0);
    expect(within(main).getByRole('button', { name: 'Select Main group' })).toBeInTheDocument();
  });

  it('never submits a form around the tree from its Select button', () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <TreeView nodes={groups} onSelect={onSelect} expandOnNameClick selectLabel="Select" />
      </form>,
    );
    fireEvent.click(within(row(container, 'main')).getByText('Select'));
    expect(onSelect).toHaveBeenCalledWith('main');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('leaves the open groups as they were when a name is clicked during a search', () => {
    const { container, rerender } = render(
      <TreeView nodes={groups} expandOnNameClick selectLabel="Select" query="leaf" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Main group' }));
    rerender(<TreeView nodes={groups} expandOnNameClick selectLabel="Select" />);
    expect(row(container, 'main')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Leaf')).toBeInTheDocument();
  });
});
