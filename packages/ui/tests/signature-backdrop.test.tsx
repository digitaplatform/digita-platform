// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SignatureBackdrop } from '@/components/layout/SignatureBackdrop';
import { useThemeStore } from '@/stores/theme';

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

  it('renders nothing for a thin signature (simetrix carries no graphics)', () => {
    useThemeStore.setState({ signature: 'simetrix' });
    const { container } = render(<SignatureBackdrop />);
    expect(screen.queryByTestId('signature-backdrop')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
