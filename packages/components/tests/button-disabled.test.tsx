import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../src/primitives/Button.js';
import { IconButton } from '../src/primitives/IconButton.js';

// A disabled primary button keeps its fill and label and shows at half opacity: a
// lighter fill under a dark label read as an enabled tonal button for a light tint.
describe('a disabled primary button', () => {
  it('keeps the primary fill, even on hover, and dims to half opacity', () => {
    render(<Button disabled>Save</Button>);
    const classes = screen.getByRole('button', { name: 'Save' }).className.split(/\s+/);
    expect(classes).toContain('bg-primary-600');
    expect(classes).toContain('disabled:bg-primary-600');
    expect(classes).toContain('disabled:opacity-50');
    expect(classes).not.toContain('disabled:bg-primary-300');
  });

  it('holds for the primary IconButton too, which has no fill of its own when disabled', () => {
    render(<IconButton label="Add" icon={<span />} variant="primary" disabled />);
    const classes = screen.getByRole('button', { name: 'Add' }).className.split(/\s+/);
    expect(classes).toContain('disabled:opacity-50');
    expect(classes.some((c) => c.startsWith('disabled:bg-'))).toBe(false);
  });
});
