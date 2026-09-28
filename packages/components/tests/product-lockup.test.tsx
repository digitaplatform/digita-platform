// @vitest-environment jsdom
// The family lockup: one component renders `digita ● <product>` for every product of the
// family, and the brand precedence hands it the family's names and nothing else.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BrandMark, ProductLockup, productWord } from '../src/index.js';

afterEach(cleanup);

describe('ProductLockup', () => {
  it('renders the family word, the accent dot and the product word', () => {
    render(<ProductLockup family="digita" product="erp" />);
    const lockup = screen.getByTestId('brand-lockup');
    expect(lockup).toHaveAttribute('aria-label', 'digita erp');
    expect(lockup.textContent).toBe('digitaerp');
    const dot = screen.getByTestId('brand-lockup-dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // The planted defect this test exists for: a dot that is not the accent. The dot is
    // `bg-primary-600` (the signature's accent anchors that ramp) and nothing else.
    expect(dot.className).toContain('bg-primary-600');
    expect(dot.className).not.toMatch(/bg-(error|warning|success|primary-[^6])/);
  });

  it('derives the product word from the name the surface knows', () => {
    expect(productWord('Digita Platform', 'digita')).toBe('platform');
    expect(productWord('ERP', 'digita')).toBe('erp');
    expect(productWord('digita ● cloud', 'digita')).toBe('cloud');
    expect(productWord('BuildProject', 'digita')).toBe('buildproject');
    expect(productWord('Digita', 'digita')).toBe('platform');
  });
});

describe('BrandMark with a lockup family', () => {
  const digita = { id: 'digita', family: 'digita', monogram: '<svg data-m="1"></svg>', wordmark: '<svg data-w="1"></svg>' };

  it('renders the lockup for the family name when the tenant set no name', () => {
    render(<BrandMark name="ERP" signature={digita} />);
    expect(screen.getByTestId('brand-lockup')).toHaveAttribute('aria-label', 'ERP');
    expect(screen.queryByTestId('brand-wordmark')).toBeNull();
  });

  it('renders the lockup for a custom name that spells the family, text for any other', () => {
    const { rerender, container } = render(<BrandMark name="Digita Platform" nameIsCustom signature={digita} />);
    expect(screen.getByTestId('brand-lockup').textContent).toBe('digitaplatform');
    rerender(<BrandMark name="simetrix" nameIsCustom signature={digita} />);
    expect(screen.queryByTestId('brand-lockup')).toBeNull();
    expect(container.querySelector('[data-m]')).not.toBeNull();
    expect(screen.getByText('simetrix')).toBeInTheDocument();
  });

  it('lets the tenant logo win over the lockup', () => {
    const { container } = render(<BrandMark name="ERP" logoUrl="/logo.png" signature={digita} />);
    expect(screen.queryByTestId('brand-lockup')).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute('src', '/logo.png');
  });

  it('stands in the family for the published digita signature that carries no family yet', () => {
    render(<BrandMark name="Digita" signature={{ id: 'digita', wordmark: '<svg data-w="1"></svg>' }} />);
    expect(screen.getByTestId('brand-lockup').textContent).toBe('digitaplatform');
  });
});
