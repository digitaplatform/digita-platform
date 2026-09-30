import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../src/primitives/Badge.js';
import { Chip } from '../src/primitives/Chip.js';

// A soft or pill primary badge draws on the tint's container roles, which the theme derives per mode
// with AA contrast (theme test "the tonal primary container"). The fixed ramp steps it used before
// kept a dark step-700 label in dark mode: 2.33:1 on the site's dark card.
describe('a primary badge', () => {
  it('draws a soft and a pill badge on the container roles, not on fixed ramp steps', () => {
    for (const variant of ['soft', 'pill'] as const) {
      render(<Badge variant={variant} color="primary">{variant}</Badge>);
      const classes = screen.getByText(variant).className.split(/\s+/);
      expect(classes, variant).toContain('bg-primaryContainer');
      expect(classes, variant).toContain('text-onPrimaryContainer');
      expect(classes, variant).not.toContain('text-primary-700');
    }
  });

  it('labels an outline badge with the container label, readable on either page', () => {
    render(<Badge variant="outline" color="primary">outline</Badge>);
    const classes = screen.getByText('outline').className.split(/\s+/);
    expect(classes).toContain('text-onPrimaryContainer');
    expect(classes).not.toContain('text-primary-700');
  });

  it('draws a selected chip on the container roles, an unselected one on the surface', () => {
    render(<Chip selected onClick={() => {}}>on</Chip>);
    render(<Chip onClick={() => {}}>off</Chip>);
    const on = screen.getByRole('button', { name: 'on' }).className.split(/\s+/);
    expect(on).toContain('bg-primaryContainer');
    expect(on).toContain('text-onPrimaryContainer');
    expect(screen.getByRole('button', { name: 'off' }).className.split(/\s+/)).toContain('bg-surface');
  });

  it('leaves the other colours on their own roles (innocent case)', () => {
    render(<Badge color="success">ok</Badge>);
    expect(screen.getByText('ok').className.split(/\s+/)).toContain('text-success');
  });
});
