import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../src/primitives/Input.js';
import { TextField } from '../src/primitives/TextField.js';
import { Select } from '../src/primitives/Select.js';
import { Badge } from '../src/primitives/Badge.js';
import { IconButton } from '../src/primitives/IconButton.js';
import { DataGrid, type DataGridColumn } from '../src/composites/DataGrid.js';

/** The attributes a design's CSS keys on: a state the kit used to hold only in a class
 *  or in React state is an attribute on the hook, so every design reaches it. */

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('input-frame and textfield mirror the state of the control they frame', () => {
  it('input-frame carries aria-invalid, data-disabled and data-readonly', () => {
    const { container, rerender } = render(<Input label="Name" errorMessage="Required" />);
    const frame = () => container.querySelector('[data-ui="input-frame"]')!;
    expect(frame()).toHaveAttribute('aria-invalid', 'true');
    expect(frame()).not.toHaveAttribute('data-disabled');
    rerender(<Input label="Name" disabled readOnly />);
    expect(frame()).not.toHaveAttribute('aria-invalid');
    expect(frame()).toHaveAttribute('data-disabled', 'true');
    expect(frame()).toHaveAttribute('data-readonly', 'true');
  });

  it('textfield carries aria-invalid, data-invalid, data-disabled and data-readonly', () => {
    const { container, rerender } = render(<TextField label="Name" error />);
    const field = () => container.querySelector('[data-ui="textfield"]')!;
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    // The released designs key their textfield rules on data-invalid.
    expect(field()).toHaveAttribute('data-invalid', 'true');
    rerender(<TextField label="Name" disabled readOnly />);
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(field()).not.toHaveAttribute('data-invalid');
    expect(field()).toHaveAttribute('data-disabled', 'true');
    expect(field()).toHaveAttribute('data-readonly', 'true');
  });
});

describe('Select', () => {
  it('marks the keyboard-highlighted option with data-active, apart from the chosen one', async () => {
    const user = userEvent.setup();
    render(<Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />);
    await user.click(screen.getByRole('combobox', { name: 'pick' }));
    await user.keyboard('{ArrowDown}');
    const [alpha, beta] = screen.getAllByRole('option');
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(alpha).not.toHaveAttribute('data-active');
    expect(beta).toHaveAttribute('data-active', 'true');
  });

  it('emits aria-expanded on a searchable trigger too', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select searchable value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />,
    );
    const trigger = container.querySelector('[data-ui="select-trigger"]')!;
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('badge and icon-button expose the axis a design sizes or tints by', () => {
  it('badge carries data-color', () => {
    render(<Badge color="success">Paid</Badge>);
    expect(screen.getByText('Paid')).toHaveAttribute('data-color', 'success');
  });
  it('icon-button carries data-size', () => {
    render(<IconButton label="Close" size="sm" icon={<span>x</span>} />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('data-size', 'sm');
  });
});

describe('DataGrid row', () => {
  // jsdom lays nothing out: give the virtualizer a viewport so rows mount.
  const RECT = { width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  const origRect = HTMLElement.prototype.getBoundingClientRect;
  const origRO = globalThis.ResizeObserver;
  beforeAll(() => {
    HTMLElement.prototype.getBoundingClientRect = () => RECT;
    globalThis.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(target: Element) {
        const size = [{ inlineSize: RECT.width, blockSize: RECT.height }];
        const entry = { target, contentRect: RECT, borderBoxSize: size, contentBoxSize: size };
        this.cb([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    HTMLElement.prototype.getBoundingClientRect = origRect;
    globalThis.ResizeObserver = origRO;
  });

  const COLS: DataGridColumn[] = [{ key: 'name', label: 'Name', kind: 'text' }];
  const ROWS = [{ id: 'r1', name: 'Apple' }, { id: 'r2', name: 'Pear' }];

  it('carries data-active on the row of the focused cell and no inline height', async () => {
    const user = userEvent.setup();
    render(
      <DataGrid rows={ROWS} columns={COLS} getRowId={(r) => r.id} editable={false} aria-label="lines" />,
    );
    const rows = () => document.querySelectorAll<HTMLElement>('[data-ui="table-row"]');
    expect(rows()).toHaveLength(2);
    for (const row of rows()) {
      expect(row).not.toHaveAttribute('data-active');
      expect(row.style.height).toBe('');
      expect(row.className).toContain('min-h-[calc(var(--density-row)*1px)]');
    }
    await user.click(rows()[1]!.querySelector('[role="gridcell"]')!);
    expect(rows()[1]).toHaveAttribute('data-active', 'true');
    expect(rows()[0]).not.toHaveAttribute('data-active');
    // The grid has no selection model, so focus is never reported as selection.
    expect(rows()[1]).not.toHaveAttribute('aria-selected');
  });
});
