import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseDialog } from '../src/composites/BaseDialog.js';

describe('BaseDialog focus management', () => {
  it('moves initial focus into the BODY, not onto the header close button', () => {
    render(
      <BaseDialog open onClose={() => {}} title="Search">
        <input aria-label="search-box" />
      </BaseDialog>,
    );
    expect(screen.getByLabelText('search-box')).toHaveFocus();
  });

  it('keeps focus stable across re-renders with a NEW onClose identity per keystroke', async () => {
    const user = userEvent.setup();
    function Host() {
      const [q, setQ] = useState('');
      // Inline arrow = new identity on every render — the old BaseDialog
      // re-ran its focus effect on this and yanked focus per keystroke.
      return (
        <BaseDialog open onClose={() => setQ('')} title="Search">
          <input aria-label="search-box" value={q} onChange={(e) => setQ(e.target.value)} />
        </BaseDialog>
      );
    }
    render(<Host />);
    const box = screen.getByLabelText('search-box');
    await user.type(box, 'acme');
    expect(box).toHaveValue('acme');
    expect(box).toHaveFocus();
  });

  it('Escape closes stacked dialogs one at a time, topmost first', async () => {
    const closeOuter = vi.fn();
    function Host() {
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <BaseDialog open onClose={closeOuter} title="Outer">
          <button onClick={() => setInnerOpen(true)}>open inner</button>
          <BaseDialog open={innerOpen} onClose={() => setInnerOpen(false)} title="Inner">
            <input aria-label="inner-box" />
          </BaseDialog>
        </BaseDialog>
      );
    }
    render(<Host />);
    // Open the inner dialog AFTER the outer one — the real stacking sequence.
    fireEvent.click(screen.getByRole('button', { name: 'open inner' }));
    expect(screen.getByLabelText('inner-box')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    // The inner dialog lingers ~160ms for its exit animation, then unmounts.
    await waitFor(() => expect(screen.queryByLabelText('inner-box')).not.toBeInTheDocument());
    expect(closeOuter).not.toHaveBeenCalled(); // outer survived the same Escape

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(closeOuter).toHaveBeenCalledTimes(1); // next Escape reaches the outer
  });

  it('ignores an Escape that a popover already consumed (defaultPrevented)', () => {
    const onClose = vi.fn();
    render(
      <BaseDialog open onClose={onClose} title="Search">
        <input aria-label="search-box" />
      </BaseDialog>,
    );
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    evt.preventDefault(); // a Popover/Combobox claimed it in the capture phase
    document.body.dispatchEvent(evt);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('restores focus on close by default, and skips it with restoreFocus={false}', () => {
    function Host({ restore }: { restore: boolean }) {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          <BaseDialog open={open} onClose={() => setOpen(false)} title="D" restoreFocus={restore}>
            <button onClick={() => setOpen(false)}>done</button>
          </BaseDialog>
        </>
      );
    }
    const first = render(<Host restore />);
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    fireEvent.click(opener); // open — restore target = opener
    fireEvent.click(screen.getByRole('button', { name: 'done' })); // close
    expect(opener).toHaveFocus();
    first.unmount();

    render(<Host restore={false} />);
    const opener2 = screen.getByRole('button', { name: 'opener' });
    opener2.focus();
    fireEvent.click(opener2);
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    expect(opener2).not.toHaveFocus();
  });

  it('locks body scroll while at least one dialog is open', () => {
    const { unmount } = render(
      <BaseDialog open onClose={() => {}} title="D">
        <div>body</div>
      </BaseDialog>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
