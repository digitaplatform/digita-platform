import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../src/primitives/Switch.js';
import { SegmentedControl } from '../src/primitives/SegmentedControl.js';
import { Badge } from '../src/primitives/Badge.js';
import { Chip } from '../src/primitives/Chip.js';
import { Fab } from '../src/primitives/Fab.js';
import { TextField } from '../src/primitives/TextField.js';
import { Sheet } from '../src/composites/Sheet.js';

describe('Switch', () => {
  it('is a role=switch reflecting checked, toggles on click, and via the label', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Wireless" />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Wireless'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('SegmentedControl', () => {
  const opts = [
    { value: 'a', label: 'List' },
    { value: 'b', label: 'Tree' },
  ];
  it('renders a radiogroup, marks the selected radio, and selects on click', () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="View" options={opts} value="a" onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    const [a, b] = screen.getAllByRole('radio');
    expect(a).toHaveAttribute('aria-checked', 'true');
    expect(b).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(b!);
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('moves selection with the arrow keys (roving tabindex)', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="View" options={opts} value="a" onChange={onChange} />);
    const a = screen.getAllByRole('radio')[0]!;
    a.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('renders the purely visual sliding thumb under the selection', () => {
    const { container } = render(
      <SegmentedControl aria-label="View" options={opts} value="a" onChange={() => {}} />,
    );
    const thumb = container.querySelector('[data-ui="segmented-thumb"]')!;
    expect(thumb).toBeTruthy();
    expect(thumb).toHaveAttribute('aria-hidden', 'true');
    expect(thumb.className).toContain('pointer-events-none');
    expect(thumb.className).toContain('duration-base'); // animates on the motion tokens
    // Purely visual: still exactly two radios, selection semantics unchanged.
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Badge categorical colors', () => {
  it('keeps the neutral default untouched', () => {
    render(<Badge>Draft</Badge>);
    const badge = screen.getByText('Draft');
    expect(badge.className).toContain('bg-subtle');
    expect(badge.className).toContain('text-textMuted');
  });
  it('soft variant renders bg-cat-N-soft + text-cat-N', () => {
    render(<Badge color="cat-3">Invoices</Badge>);
    const badge = screen.getByText('Invoices');
    expect(badge.className).toContain('bg-cat-3-soft');
    expect(badge.className).toContain('text-cat-3');
  });
  it('outline variant renders border-cat-N + text-cat-N', () => {
    render(
      <Badge variant="outline" color="cat-7">
        Customers
      </Badge>,
    );
    const badge = screen.getByText('Customers');
    expect(badge.className).toContain('border-cat-7');
    expect(badge.className).toContain('text-cat-7');
    expect(badge.className).toContain('bg-transparent');
  });
});

describe('Chip', () => {
  it('reflects selected via aria-pressed and fires onClick + onRemove', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <Chip selected onClick={onClick} onRemove={onRemove}>
        Active
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: /Active/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalled();
    fireEvent.click(screen.getByText('×'));
    expect(onRemove).toHaveBeenCalled();
  });
  it('keeps the neutral default when no color is passed', () => {
    render(<Chip>All</Chip>);
    const chip = screen.getByRole('button', { name: /All/ });
    expect(chip.className).toContain('bg-surface');
    expect(chip).not.toHaveAttribute('data-color');
  });
  it('color="cat-N" renders the soft categorical fill and stamps data-color', () => {
    render(<Chip color="cat-2">Invoices</Chip>);
    const chip = screen.getByRole('button', { name: /Invoices/ });
    expect(chip.className).toContain('bg-cat-2-soft');
    expect(chip.className).toContain('text-cat-2');
    expect(chip.className).toContain('border-transparent');
    expect(chip).toHaveAttribute('data-color', 'cat-2');
  });
  it('selected categorical chip gains the solid categorical border', () => {
    render(
      <Chip color="cat-2" selected>
        Invoices
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: /Invoices/ });
    expect(chip.className).toContain('bg-cat-2-soft');
    expect(chip.className).toContain('border-cat-2');
    expect(chip.className).not.toContain('border-transparent');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Fab', () => {
  it('renders a labeled button and fires onClick; adaptive stamps data-adaptive', () => {
    const onClick = vi.fn();
    render(<Fab adaptive label="New" icon={<span>+</span>} onClick={onClick} />);
    const fab = screen.getByRole('button', { name: 'New' });
    expect(fab).toHaveAttribute('data-adaptive', '');
    fireEvent.click(fab);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('renders the labelled input and surfaces an error message', () => {
    render(<TextField label="Email" name="email" errorMessage="Required" />);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});

describe('Sheet', () => {
  it('renders a dialog in the sheet presentation with a grabber', () => {
    render(
      <Sheet open onClose={() => {}} title="Filters">
        <p>body</p>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-presentation', 'sheet');
    expect(dialog.querySelector('[data-ui="sheet-grabber"]')).toBeTruthy();
  });
});

describe('legacy literal → token cleanup (B5, no behavior change)', () => {
  it('Switch thumb rides bg-onPrimary, not a hardwired bg-white', () => {
    const { container } = render(<Switch checked onChange={() => {}} aria-label="Wifi" />);
    const thumb = container.querySelector('[data-ui="switch-thumb"]')!;
    expect(thumb.className).toContain('bg-onPrimary');
    expect(thumb.className).not.toContain('bg-white');
  });
  it('BaseDialog scrim rides the --color-scrim var (black/30 default)', () => {
    render(
      <Sheet open onClose={() => {}} title="Scrim">
        <p>body</p>
      </Sheet>,
    );
    const overlay = document.querySelector('[data-ui="dialog-overlay"]')!;
    expect(overlay.className).toContain('bg-[color:var(--color-scrim,rgba(0,0,0,0.30))]');
    expect(overlay.className).not.toContain('bg-black/30');
  });
  it('Fab floats on the z-popover token, not a literal z-40', () => {
    render(<Fab label="New" icon={<span>+</span>} onClick={() => {}} />);
    const fab = screen.getByRole('button', { name: 'New' });
    expect(fab.className).toContain('z-popover');
    expect(fab.className).not.toContain('z-40');
  });
  it('Chip remove affordance hovers with bg-bgHover, not black/10', () => {
    render(<Chip onRemove={() => {}}>Tag</Chip>);
    const remove = screen.getByText('×');
    expect(remove.className).toContain('hover:bg-bgHover');
    expect(remove.className).not.toContain('bg-black/10');
  });
});
