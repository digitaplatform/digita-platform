import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type Ref } from 'react';
import { SwipeRow, type SwipeAction } from '../src/primitives/SwipeRow.js';

// jsdom has no layout/pointer physics — widths fall back to the component's
// deterministic constants (88px per action, 360px row), so the latch/commit
// thresholds of the state machine are exact and testable.

function makeActions() {
  const onPin = vi.fn();
  const onMore = vi.fn();
  const onDelete = vi.fn();
  const leading: SwipeAction[] = [{ key: 'pin', label: 'Pin', onAction: onPin }];
  const trailing: SwipeAction[] = [
    { key: 'more', label: 'More', icon: <svg data-testid="more-icon" />, onAction: onMore },
    { key: 'delete', label: 'Delete', variant: 'danger', onAction: onDelete },
  ];
  return { leading, trailing, onPin, onMore, onDelete };
}

function renderRow(ref?: Ref<HTMLDivElement>) {
  const actions = makeActions();
  const utils = render(
    <SwipeRow ref={ref} leading={actions.leading} trailing={actions.trailing}>
      <div>Row content</div>
    </SwipeRow>,
  );
  const root = utils.container.querySelector<HTMLElement>('[data-ui="swipe-row"]')!;
  const content = utils.container.querySelector<HTMLElement>('[data-ui="swipe-row-content"]')!;
  return { ...utils, ...actions, root, content };
}

const touch = { pointerType: 'touch', pointerId: 1 };

describe('SwipeRow', () => {
  it('renders the content, both trays as REAL buttons, the menu trigger, and forwards the ref', () => {
    const ref = createRef<HTMLDivElement>();
    const { root } = renderRow(ref);
    expect(screen.getByText('Row content')).toBeInTheDocument();
    expect(ref.current).toBe(root);
    expect(root).toHaveAttribute('data-open', 'none');

    const trays = screen.getAllByRole('group');
    expect(trays).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Leading row actions' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Trailing row actions' })).toBeInTheDocument();

    // Every action is a real, focusable <button> — no gesture required.
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('data-ui', 'swipe-row-action');
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('data-ui', 'swipe-row-action');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('data-ui', 'swipe-row-action');
    // Plus the keyboard-openable fallback menu.
    expect(screen.getByRole('button', { name: 'Row actions' })).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('labels the danger action and carries data-variant on every tray button', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('data-variant', 'danger');
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('data-variant', 'default');
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('data-variant', 'default');
  });

  it('fires the action from the tray button (keyboard/click fallback) and closes the tray', async () => {
    const { root, onDelete } = renderRow();
    fireEvent.focus(screen.getByRole('button', { name: 'Delete' }));
    expect(root).toHaveAttribute('data-open', 'trailing');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(root).toHaveAttribute('data-open', 'none');
  });

  it('exposes every action (danger included) in the keyboard-openable menu', async () => {
    const { onMore } = renderRow();
    await userEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    const menu = screen.getByRole('menu', { name: 'Row actions' });
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Pin', 'More', 'Delete']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'More' }));
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reveals the tray on focus, and Escape resets the state', async () => {
    const { root } = renderRow();
    fireEvent.focus(screen.getByRole('button', { name: 'Pin' }));
    expect(root).toHaveAttribute('data-open', 'leading');
    await userEvent.keyboard('{Escape}');
    expect(root).toHaveAttribute('data-open', 'none');
  });

  it('closes an open tray on an outside pointerdown', () => {
    const { root } = renderRow();
    fireEvent.focus(screen.getByRole('button', { name: 'Delete' }));
    expect(root).toHaveAttribute('data-open', 'trailing');
    fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    expect(root).toHaveAttribute('data-open', 'none');
  });

  it('latches the trailing tray open when a touch swipe passes half the tray width', () => {
    const { root, content, onDelete, onMore } = renderRow();
    // trailing tray fallback = 2 × 88 = 176px → latch at ≥ 88px.
    fireEvent.pointerDown(content, { ...touch, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(content, { ...touch, clientX: 170, clientY: 12 }); // dx −130
    fireEvent.pointerUp(content, { ...touch, clientX: 170, clientY: 12 });
    expect(root).toHaveAttribute('data-open', 'trailing');
    expect(content.style.transform).toBe('translateX(-176px)');
    expect(onDelete).not.toHaveBeenCalled();
    expect(onMore).not.toHaveBeenCalled();
  });

  it('snaps back closed when the swipe stays under the latch threshold', () => {
    const { root, content } = renderRow();
    fireEvent.pointerDown(content, { ...touch, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(content, { ...touch, clientX: 260, clientY: 10 }); // dx −40 < 88
    fireEvent.pointerUp(content, { ...touch, clientX: 260, clientY: 10 });
    expect(root).toHaveAttribute('data-open', 'none');
    expect(content.style.transform).toBe('translateX(0px)');
  });

  it('latches the LEADING tray on a rightward swipe', () => {
    const { root, content } = renderRow();
    // leading tray fallback = 1 × 88 = 88px → latch at ≥ 44px.
    fireEvent.pointerDown(content, { ...touch, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(content, { ...touch, clientX: 80, clientY: 10 }); // dx +70
    fireEvent.pointerUp(content, { ...touch, clientX: 80, clientY: 10 });
    expect(root).toHaveAttribute('data-open', 'leading');
  });

  it('commits the FIRST trailing action on a full swipe (fullSwipe)', () => {
    const onDelete = vi.fn();
    const { container } = render(
      <SwipeRow
        fullSwipe
        trailing={[{ key: 'delete', label: 'Delete', variant: 'danger', onAction: onDelete }]}
      >
        <div>Row</div>
      </SwipeRow>,
    );
    const root = container.querySelector<HTMLElement>('[data-ui="swipe-row"]')!;
    const content = container.querySelector<HTMLElement>('[data-ui="swipe-row-content"]')!;
    // tray 88px → commit at max(88+56, 360×0.6) = 216px.
    fireEvent.pointerDown(content, { ...touch, clientX: 340, clientY: 10 });
    fireEvent.pointerMove(content, { ...touch, clientX: 40, clientY: 10 }); // dx −300
    fireEvent.pointerUp(content, { ...touch, clientX: 40, clientY: 10 });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(root).toHaveAttribute('data-open', 'none');
  });

  it('never hijacks a FINE-pointer (mouse) drag', () => {
    const { root, content, onDelete } = renderRow();
    fireEvent.pointerDown(content, { pointerType: 'mouse', pointerId: 2, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(content, { pointerType: 'mouse', pointerId: 2, clientX: 100, clientY: 10 });
    fireEvent.pointerUp(content, { pointerType: 'mouse', pointerId: 2, clientX: 100, clientY: 10 });
    expect(root).toHaveAttribute('data-open', 'none');
    expect(content.style.transform).toBe('translateX(0px)');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('leaves vertical (scroll) gestures alone via the axis lock', () => {
    const { root, content } = renderRow();
    fireEvent.pointerDown(content, { ...touch, clientX: 300, clientY: 10 });
    fireEvent.pointerMove(content, { ...touch, clientX: 280, clientY: 90 }); // dy 80 > |dx| 20
    fireEvent.pointerUp(content, { ...touch, clientX: 280, clientY: 90 });
    expect(root).toHaveAttribute('data-open', 'none');
    expect(content.style.transform).toBe('translateX(0px)');
  });
});
