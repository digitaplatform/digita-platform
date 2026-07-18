// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { registerSignature } from '@digitaplatform/theme';
import { SignatureBackdrop } from '@/components/layout/SignatureBackdrop';
import { useThemeStore } from '@/stores/theme';

// digita is a DELIVERED free signature now (not baked) — register it so
// getSignature('digita') resolves its graphics, as it would after composition.
beforeEach(() => {
  registerSignature({
    id: 'digita',
    name: 'Digita',
    accent: '#2077C8',
    graphics: {
      grid: { light: 'linear-gradient(a)', dark: 'linear-gradient(b)' },
      glow: { light: 'radial-gradient(c)', dark: 'radial-gradient(d)' },
    },
  });
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ signature: 'digita' });
});

describe('SignatureBackdrop', () => {
  it('paints the grid + glow layers for a FULL signature (digita)', () => {
    useThemeStore.setState({ signature: 'digita' });
    render(<SignatureBackdrop />);
    const backdrop = screen.getByTestId('signature-backdrop');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    // Exactly two decorative layers: the grid and the glow.
    expect(backdrop.children).toHaveLength(2);
  });

  it('renders nothing for a thin signature (no graphics)', () => {
    // A thin signature carries no graphics; the backdrop must not fall back to
    // the default's grid/glow just because this one has none.
    registerSignature({ id: 'thinbrand', name: 'Thin', accent: '#0E6FB8' });
    useThemeStore.setState({ signature: 'thinbrand' });
    const { container } = render(<SignatureBackdrop />);
    expect(screen.queryByTestId('signature-backdrop')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
