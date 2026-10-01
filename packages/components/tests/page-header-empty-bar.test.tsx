import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../src/composites/PageHeader.js';

// A header without a back link and without actions has nothing to show in its bar until it
// sticks, so the bar paints no band above the title; once stuck, the bar carries the
// compact title on its own background. jsdom has no stylesheet: the test reads the classes.
const bar = () => document.querySelector('[data-ui="page-header-bar"]') as HTMLElement;

describe('PageHeader bar without back and actions', () => {
  it('paints no band above the title while the header stands whole', () => {
    render(<PageHeader title="Workshop settings" collapsed={false} />);
    expect(bar().className).not.toContain('bg-surface');
    expect(bar().className).toContain('bg-transparent');
    // A design that paints the bar keys its background off this, so the band goes there too.
    expect(bar()).toHaveAttribute('data-empty', 'true');
  });

  it('shows the compact title on the bar background once the header sticks', () => {
    render(<PageHeader title="Workshop settings" collapsed />);
    expect(bar().className).toContain('bg-surface');
    expect(bar().querySelector('[data-ui="page-header-bar-title"]')).toHaveTextContent('Workshop settings');
    expect(bar()).not.toHaveAttribute('data-empty');
  });

  it('keeps the band for a back link or actions', () => {
    const { unmount } = render(<PageHeader title="Quote 7" back={{ label: 'Quotes', onClick: () => {} }} collapsed={false} />);
    expect(bar().className).toContain('bg-surface');
    expect(screen.getByRole('button', { name: 'Quotes' })).toBeInTheDocument();
    expect(bar()).not.toHaveAttribute('data-empty');
    unmount();
    render(<PageHeader title="Quotes" actions={<button type="button">New</button>} collapsed={false} />);
    expect(bar().className).toContain('bg-surface');
    expect(bar()).not.toHaveAttribute('data-empty');
  });
});
