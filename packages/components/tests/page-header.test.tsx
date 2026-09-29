import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef, useRef } from 'react';
import { PageHeader } from '../src/composites/PageHeader.js';

/** Scroll container harness — drives the collapse through the scrollRef prop. */
function ScrollHarness({ threshold }: { threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scroller" style={{ overflowY: 'auto', height: '200px' }}>
      <PageHeader title="Invoices" scrollRef={ref} collapseThreshold={threshold} />
      <div style={{ height: '1000px' }} />
    </div>
  );
}

describe('PageHeader', () => {
  it('renders the title as a SINGLE accessible heading inside a banner, and forwards the ref', () => {
    const ref = createRef<HTMLElement>();
    render(<PageHeader ref={ref} title="Invoices" />);
    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-ui', 'page-header');
    expect(header).toHaveAttribute('data-collapsed', 'false');
    expect(ref.current).toBe(header);
    // Exactly one heading — the compact bar mirror is aria-hidden.
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName('Invoices');
    const mirror = header.querySelector('[data-ui="page-header-bar-title"]');
    expect(mirror).toHaveAttribute('aria-hidden', 'true');
    expect(mirror).toHaveTextContent('Invoices');
  });

  it('renders the back action named after the previous page and fires onClick', () => {
    const onClick = vi.fn();
    render(<PageHeader title="Invoice 4711" back={{ label: 'Invoices', onClick }} />);
    const back = screen.getByRole('button', { name: 'Invoices' });
    expect(back).toHaveAttribute('data-ui', 'page-header-back');
    // Both glyphs are in the DOM — the active design's CSS picks one.
    expect(back.querySelector('[data-ui="page-header-back-chevron"]')).toBeInTheDocument();
    expect(back.querySelector('[data-ui="page-header-back-arrow"]')).toBeInTheDocument();
    fireEvent.click(back);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts a ReactNode back slot (router links) and renders it as-is', () => {
    render(<PageHeader title="Invoice 4711" back={<a href="/invoices">All invoices</a>} />);
    expect(screen.getByRole('link', { name: 'All invoices' })).toHaveAttribute('href', '/invoices');
    expect(document.querySelector('[data-ui="page-header-back"]')).not.toBeInTheDocument();
  });

  it('renders trailing actions and the search slot', () => {
    render(
      <PageHeader
        title="Invoices"
        actions={<button type="button">Export</button>}
        search={<input type="search" aria-label="Search invoices" />}
      />,
    );
    const actions = document.querySelector('[data-ui="page-header-actions"]');
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Export' }));
    const search = document.querySelector('[data-ui="page-header-search"]');
    expect(search).toContainElement(screen.getByRole('searchbox', { name: 'Search invoices' }));
  });

  it('toggles data-collapsed from the scrollRef source (past and back across the threshold)', () => {
    render(<ScrollHarness threshold={40} />);
    const scroller = screen.getByTestId('scroller');
    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('data-collapsed', 'false');
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    expect(header).toHaveAttribute('data-collapsed', 'true');
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(header).toHaveAttribute('data-collapsed', 'false');
  });

  it('defaults to the nearest scrollable ancestor when no scrollRef is given', () => {
    render(
      <div data-testid="auto-scroller" style={{ overflowY: 'auto', height: '200px' }}>
        <PageHeader title="Invoices" />
      </div>,
    );
    const scroller = screen.getByTestId('auto-scroller');
    const header = screen.getByRole('banner');
    scroller.scrollTop = 50; // jsdom measures no heights → default threshold 1
    fireEvent.scroll(scroller);
    expect(header).toHaveAttribute('data-collapsed', 'true');
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(header).toHaveAttribute('data-collapsed', 'false');
  });

  it('collapses the moment it sticks, not at an offset measured from its own height', () => {
    // jsdom lays nothing out, so the harness answers the geometry: 40px of padding above a
    // 120px header with a 48px bar, in a scroller with no top bar. The header sticks once
    // 40 + 72 = 112px have scrolled; at 100px its lower 12px still show below the bar.
    const getBoundingClientRect = Element.prototype.getBoundingClientRect;
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const scrolled = screen.queryByTestId('scroller')?.scrollTop ?? 0;
      const headerTop = Math.max(40 - scrolled, -72);
      if (this.getAttribute('data-ui') === 'page-header') return rect(headerTop, 120);
      if (this.getAttribute('data-ui') === 'page-header-bar') return rect(Math.max(headerTop, 0), 48);
      return getBoundingClientRect.call(this);
    };
    try {
      render(
        <div data-testid="scroller" style={{ overflowY: 'auto', height: '200px' }}>
          <div style={{ height: '40px' }} />
          <PageHeader title="Invoices" search={<input type="search" aria-label="Search invoices" />} />
        </div>,
      );
      const scroller = screen.getByTestId('scroller');
      const header = screen.getByRole('banner');
      scroller.scrollTop = 100;
      fireEvent.scroll(scroller);
      expect(header).toHaveAttribute('data-collapsed', 'false');
      scroller.scrollTop = 112;
      fireEvent.scroll(scroller);
      expect(header).toHaveAttribute('data-collapsed', 'true');
      // The faded search still takes focus; taking it scrolls the page to the top, where the
      // header stands whole, and the header opens again with that scroll.
      screen.getByRole('searchbox').focus();
      expect(scroller.scrollTop).toBe(0);
      fireEvent.scroll(scroller);
      expect(header).toHaveAttribute('data-collapsed', 'false');
    } finally {
      Element.prototype.getBoundingClientRect = getBoundingClientRect;
    }
  });

  it('wraps a title without a break opportunity instead of overflowing the page', () => {
    render(<PageHeader title="billing.contact.acme.international@examplecustomerdomain.com" />);
    expect(screen.getByRole('heading').className).toContain('[overflow-wrap:anywhere]');
  });

  it('honors the controlled collapsed prop over scroll tracking', () => {
    const { rerender } = render(<PageHeader title="Invoices" collapsed />);
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'true');
    rerender(<PageHeader title="Invoices" collapsed={false} />);
    expect(screen.getByRole('banner')).toHaveAttribute('data-collapsed', 'false');
  });
});
