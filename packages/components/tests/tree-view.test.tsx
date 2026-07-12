import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
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
