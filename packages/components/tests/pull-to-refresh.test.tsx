import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PullToRefresh } from '../src/primitives/PullToRefresh.js';

// jsdom has no scrolling/pointer physics — the tests drive the component's
// pointer handlers directly (threshold crossing, damping, passthrough) and
// assert the exposed state: onRefresh calls + the indicator lifecycle.

const touch = { pointerType: 'touch', pointerId: 1 };

function setup(props: Partial<Parameters<typeof PullToRefresh>[0]> = {}) {
  let resolve!: () => void;
  const onRefresh = vi.fn(() => new Promise<void>((r) => (resolve = r)));
  const utils = render(
    <PullToRefresh onRefresh={onRefresh} threshold={64} {...props}>
      <div data-testid="body">List body</div>
    </PullToRefresh>,
  );
  const root = utils.container.querySelector<HTMLElement>('[data-ui="pull-to-refresh"]')!;
  const indicator = () => utils.container.querySelector('[data-ui="pull-to-refresh-indicator"]');
  return { ...utils, onRefresh, resolve: () => resolve(), root, indicator };
}

/** Pull dy physical px straight down at scrollTop 0, then release. */
function pull(root: HTMLElement, dy: number, release = true) {
  fireEvent.pointerDown(root, { ...touch, clientX: 50, clientY: 10 });
  fireEvent.pointerMove(root, { ...touch, clientX: 50, clientY: 10 + dy });
  if (release) fireEvent.pointerUp(root, { ...touch, clientX: 50, clientY: 10 + dy });
}

describe('PullToRefresh', () => {
  it('renders its children and no indicator while idle', () => {
    const { root, indicator } = setup();
    expect(screen.getByTestId('body')).toHaveTextContent('List body');
    expect(root).toHaveAttribute('data-refreshing', 'false');
    expect(indicator()).toBeNull();
  });

  it('fires onRefresh when the (damped) pull crosses the threshold, spinner shown until the promise settles', async () => {
    const { root, indicator, onRefresh, resolve } = setup();
    // 180 physical px × 0.5 damping = 90 ≥ 64 → must trigger.
    fireEvent.pointerDown(root, { ...touch, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(root, { ...touch, clientX: 50, clientY: 190 });
    // While the finger is down past the slop, the indicator is already visible.
    expect(indicator()).not.toBeNull();
    fireEvent.pointerUp(root, { ...touch, clientX: 50, clientY: 190 });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Pending promise → refreshing: spinner + live announcement stay up.
    expect(root).toHaveAttribute('data-refreshing', 'true');
    expect(indicator()).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…');

    await act(async () => resolve());
    expect(root).toHaveAttribute('data-refreshing', 'false');
    expect(indicator()).toBeNull();
  });

  it('does NOT fire below the threshold and resets the indicator on release', () => {
    const { root, indicator, onRefresh } = setup();
    pull(root, 60); // 60 × 0.5 = 30 < 64
    expect(onRefresh).not.toHaveBeenCalled();
    expect(root).toHaveAttribute('data-refreshing', 'false');
    expect(indicator()).toBeNull();
  });

  it('respects a custom threshold', () => {
    const { root, onRefresh } = setup({ threshold: 100 });
    pull(root, 150); // 75 < 100
    expect(onRefresh).not.toHaveBeenCalled();
    pull(root, 250); // 125 ≥ 100
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('is a transparent passthrough on a FINE pointer (mouse)', () => {
    const { root, indicator, onRefresh } = setup();
    fireEvent.pointerDown(root, { pointerType: 'mouse', pointerId: 2, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(root, { pointerType: 'mouse', pointerId: 2, clientX: 50, clientY: 300 });
    fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 2, clientX: 50, clientY: 300 });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(indicator()).toBeNull();
  });

  it('does nothing while disabled', () => {
    const { root, indicator, onRefresh } = setup({ disabled: true });
    pull(root, 200);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(indicator()).toBeNull();
  });

  it('never arms while the content under the finger is scrolled away from the top', () => {
    const { onRefresh } = setup();
    const body = screen.getByTestId('body');
    body.scrollTop = 40; // jsdom stores the value — the gate reads it
    fireEvent.pointerDown(body, { ...touch, clientX: 50, clientY: 10 });
    fireEvent.pointerMove(body, { ...touch, clientX: 50, clientY: 250 });
    fireEvent.pointerUp(body, { ...touch, clientX: 50, clientY: 250 });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('ignores a second pull while a refresh is still pending', async () => {
    const { root, onRefresh, resolve } = setup();
    pull(root, 200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    pull(root, 200); // still refreshing — must not re-arm
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });

  it('ignores mostly-horizontal gestures (axis lock)', () => {
    const { root, indicator, onRefresh } = setup();
    fireEvent.pointerDown(root, { ...touch, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(root, { ...touch, clientX: 200, clientY: 40 }); // dx 190 > dy 30
    fireEvent.pointerUp(root, { ...touch, clientX: 200, clientY: 40 });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(indicator()).toBeNull();
  });
});
