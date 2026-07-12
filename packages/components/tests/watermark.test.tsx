import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Watermark } from '../src/composites/Watermark.js';

describe('Watermark', () => {
  it('renders the uppercased label as a repeating SVG pattern stamp', () => {
    const { container } = render(
      <div style={{ position: 'relative' }}>
        <Watermark label="Sample data" />
      </div>,
    );
    // The pattern tile carries the UPPERCASE stamp text.
    expect(screen.getByText('SAMPLE DATA')).toBeTruthy();
    const overlay = container.querySelector('[data-ui="watermark"]')!;
    expect(overlay.className).toContain('pointer-events-none');
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('inset-0');
    // The SVG is decorative; the label is announced once via sr-only.
    expect(overlay.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Sample data').className).toContain('sr-only');
  });

  it('defaults to the warning tone at low opacity and supports other tones', () => {
    const { container, rerender } = render(<Watermark label="Draft" />);
    const overlay = () => container.querySelector('[data-ui="watermark"]')!;
    expect(overlay()).toHaveAttribute('data-tone', 'warning');
    expect(overlay().className).toContain('text-warning');
    expect(overlay().querySelector('svg')!.getAttribute('class')).toContain('opacity-10');
    rerender(<Watermark label="Draft" tone="error" />);
    expect(overlay()).toHaveAttribute('data-tone', 'error');
    expect(overlay().className).toContain('text-error');
  });

  it('density changes the pattern tile (denser = tighter repeat)', () => {
    const { container, rerender } = render(<Watermark label="X" density="dense" />);
    const pattern = () => container.querySelector('pattern')!;
    expect(container.querySelector('[data-ui="watermark"]')).toHaveAttribute('data-density', 'dense');
    const denseH = Number(pattern().getAttribute('height'));
    rerender(<Watermark label="X" density="sparse" />);
    const sparseH = Number(pattern().getAttribute('height'));
    expect(sparseH).toBeGreaterThan(denseH);
  });
});
