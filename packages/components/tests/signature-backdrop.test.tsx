// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SignatureBackdrop } from '../src/index.js';

afterEach(cleanup);

describe('SignatureBackdrop', () => {
  it('paints the grid + glow layers of a FULL signature', () => {
    render(
      <SignatureBackdrop
        graphics={{
          grid: { light: 'linear-gradient(a)', dark: 'linear-gradient(b)' },
          glow: { light: 'radial-gradient(c)', dark: 'radial-gradient(d)' },
        }}
      />,
    );
    const backdrop = screen.getByTestId('signature-backdrop');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    // Exactly two decorative layers: the grid and the glow.
    expect(backdrop.children).toHaveLength(2);
  });

  it('renders nothing for a thin signature (no graphics)', () => {
    // A thin signature carries no graphics; the backdrop must not fall back to
    // the default's grid/glow just because this one has none.
    const { container } = render(<SignatureBackdrop graphics={undefined} />);
    expect(screen.queryByTestId('signature-backdrop')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
