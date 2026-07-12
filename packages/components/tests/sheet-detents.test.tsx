import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from '../src/composites/Sheet.js';
import type { SheetDetent } from '../src/composites/BaseDialog.js';

// jsdom has no layout — the detent drag machine falls back to deterministic
// numbers: viewport = window.innerHeight (768 in jsdom), so medium = 384px and
// large = 691.2px. Drag PHYSICS are not under test (no real pointer here);
// the state machine, the exposed callback and the gesture-free paths are.

function renderSheet(props: {
  detents?: SheetDetent[];
  defaultDetent?: SheetDetent;
  onDetentChange?: (d: SheetDetent) => void;
  open?: boolean;
} = {}) {
  const { open = true, ...rest } = props;
  const utils = render(
    <Sheet open={open} onClose={() => {}} title="Filters" {...rest}>
      <input aria-label="filter-box" />
    </Sheet>,
  );
  return utils;
}

const grabber = () => screen.getByRole('button', { name: /sheet height/i });
const touch = { pointerType: 'touch', pointerId: 1 };

describe('Sheet detents', () => {
  it('applies the smallest declared detent by default and upgrades the grabber to a labeled button', () => {
    renderSheet({ detents: ['medium', 'large'] });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-presentation', 'sheet');
    expect(dialog).toHaveAttribute('data-detent', 'medium');
    // The grabber is a REAL button (a11y contract: no gesture required)…
    const btn = grabber();
    expect(btn).toHaveAttribute('data-ui', 'sheet-grabber-button');
    expect(btn).toHaveAccessibleName('Sheet height: medium');
    // …and still carries the visual pill hook the variant CSS styles.
    expect(btn.querySelector('[data-ui="sheet-grabber"]')).toBeTruthy();
  });

  it('honors defaultDetent', () => {
    renderSheet({ detents: ['medium', 'large'], defaultDetent: 'large' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    expect(grabber()).toHaveAccessibleName('Sheet height: large');
  });

  it('clicking the grabber cycles detents and fires onDetentChange', async () => {
    const onDetentChange = vi.fn();
    renderSheet({ detents: ['medium', 'large'], onDetentChange });
    await userEvent.click(grabber());
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    expect(onDetentChange).toHaveBeenLastCalledWith('large');
    await userEvent.click(grabber());
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'medium');
    expect(onDetentChange).toHaveBeenLastCalledWith('medium');
    expect(onDetentChange).toHaveBeenCalledTimes(2);
  });

  it('Arrow Up grows, Arrow Down shrinks — clamped at the ends (no wrap)', () => {
    const onDetentChange = vi.fn();
    renderSheet({ detents: ['medium', 'large'], onDetentChange });
    const btn = grabber();
    fireEvent.keyDown(btn, { key: 'ArrowUp' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    fireEvent.keyDown(btn, { key: 'ArrowUp' }); // already at the top — no-op
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    expect(onDetentChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'medium');
    expect(onDetentChange).toHaveBeenLastCalledWith('medium');
  });

  it('keeps initial focus in the BODY — the grabber button must not steal it', () => {
    renderSheet({ detents: ['medium', 'large'] });
    expect(screen.getByLabelText('filter-box')).toHaveFocus();
  });

  it('a grabber drag snaps to the NEAREST detent and fires onDetentChange', () => {
    const onDetentChange = vi.fn();
    renderSheet({ detents: ['medium', 'large'], onDetentChange });
    const btn = grabber();
    // start at medium (fallback 384px); drag UP 250px → 634px, nearer large (691.2).
    fireEvent.pointerDown(btn, { ...touch, clientY: 500 });
    fireEvent.pointerMove(btn, { ...touch, clientY: 250 });
    fireEvent.pointerUp(btn, { ...touch, clientY: 250 });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    expect(onDetentChange).toHaveBeenCalledTimes(1);
    expect(onDetentChange).toHaveBeenLastCalledWith('large');
  });

  it('a sub-slop press is not a drag — the state machine leaves the detent alone', () => {
    const onDetentChange = vi.fn();
    renderSheet({ detents: ['medium', 'large'], onDetentChange });
    const btn = grabber();
    fireEvent.pointerDown(btn, { ...touch, clientY: 500 });
    fireEvent.pointerMove(btn, { ...touch, clientY: 496 }); // 4px < 8px slop
    fireEvent.pointerUp(btn, { ...touch, clientY: 496 });
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'medium');
    expect(onDetentChange).not.toHaveBeenCalled();
  });

  it('reopening presents at the declared default again', async () => {
    function harness(open: boolean) {
      return (
        <Sheet open={open} onClose={() => {}} title="Filters" detents={['medium', 'large']}>
          <input aria-label="filter-box" />
        </Sheet>
      );
    }
    const { rerender } = render(harness(true));
    await userEvent.click(grabber());
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'large');
    rerender(harness(false));
    rerender(harness(true));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-detent', 'medium');
  });

  it('a Sheet WITHOUT detents is byte-for-byte yesterday: inert div grabber, no data-detent', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('data-detent');
    const pill = dialog.querySelector('[data-ui="sheet-grabber"]')!;
    expect(pill.tagName).toBe('DIV');
    expect(pill).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: /sheet height/i })).toBeNull();
    expect(dialog.querySelector('[data-ui="sheet-grabber-button"]')).toBeNull();
  });
});
