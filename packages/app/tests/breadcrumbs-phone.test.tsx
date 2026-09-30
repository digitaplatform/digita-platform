// @vitest-environment jsdom
// On a phone the top bar's buttons leave the breadcrumb a few pixels. A crumb shrinks to nothing
// there while a separator keeps its width, so a trail that shows its separators on a phone shows
// bare chevrons. Below md the trail shows only the current page; from md on it shows all of it.
// jsdom evaluates no media query, so the test reads from the classes which items a viewport shows,
// with the app's own breakpoints.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../tailwind.config.js';

vi.mock('@/hooks/useMeta', () => ({
  useMetaCatalog: () => ({ data: [{ name: 'Customer', label: 'Customer', label_plural: 'Customers' }], isLoading: false }),
}));

import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { useRecordTitle } from '@/stores/record-title';

const breakpoints: Record<string, unknown> = resolveConfig(tailwindConfig).theme.screens;

const DISPLAY = /^(block|inline-block|inline|flex|inline-flex|table|inline-table|flow-root|grid|inline-grid|contents|list-item|hidden)$/;

/** Whether `element` shows on a viewport `viewport` px wide: neither it nor an ancestor is
 *  `hidden` there. A wider breakpoint wins over a narrower one, and within one breakpoint `hidden`
 *  wins, as Tailwind orders its CSS. */
function shownAt(element: Element, viewport: number): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const applying: { from: number; hides: boolean }[] = [];
    for (const token of node.classList) {
      const variants = token.split(':');
      const utility = variants.pop()!;
      if (!DISPLAY.test(utility)) continue;
      if (variants.length > 1) throw new Error(`the rule reads at most one breakpoint per class: ${token}`);
      let from = 0;
      if (variants.length === 1) {
        const minWidth = breakpoints[variants[0]!];
        if (typeof minWidth !== 'string' || !/^\d+px$/.test(minWidth)) throw new Error(`not a min-width breakpoint: ${token}`);
        from = parseInt(minWidth, 10);
      }
      if (viewport >= from) applying.push({ from, hides: utility === 'hidden' });
    }
    applying.sort((a, b) => a.from - b.from || Number(a.hides) - Number(b.hides));
    if (applying.at(-1)?.hides) return false;
  }
  return true;
}

/** The separators of a trail that show on a viewport `viewport` px wide. */
const separatorsShownAt = (trail: Element, viewport: number) =>
  [...trail.querySelectorAll('li[aria-hidden="true"]')].filter((separator) => shownAt(separator, viewport));

function trailOf(html: string): Element {
  const trail = document.createElement('ol');
  trail.innerHTML = html;
  return trail;
}

describe('the rule of what a viewport shows', () => {
  it('finds the separator of a trail that shows it on every width', () => {
    const planted = trailOf('<li>Home</li><li aria-hidden="true" class="shrink-0">›</li><li class="min-w-0">Acme</li>');
    expect(separatorsShownAt(planted, 390)).toHaveLength(1);
  });

  it('passes a separator hidden below md, and shows it from md on', () => {
    const innocent = trailOf('<li class="hidden md:block">Home</li><li aria-hidden="true" class="hidden md:block">›</li><li>Acme</li>');
    expect(separatorsShownAt(innocent, 390)).toHaveLength(0);
    expect(separatorsShownAt(innocent, 768)).toHaveLength(1);
  });
});

function renderRecordTrail(): Element {
  useRecordTitle.getState().publish('Customer', 'CUST-0001', 'Acme Cycles');
  render(
    <MemoryRouter initialEntries={['/Customer/CUST-0001']}>
      <Routes>
        <Route path="/:entity/:name" element={<Breadcrumbs />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole('navigation').querySelector('ol')!;
}

describe('the breadcrumb of a record page', () => {
  it('shows no separator on a 390 px phone, only the current page', () => {
    const trail = renderRecordTrail();
    expect(separatorsShownAt(trail, 390)).toHaveLength(0);
    const shown = [...trail.querySelectorAll('li')].filter((item) => shownAt(item, 390));
    expect(shown.map((item) => item.textContent)).toEqual(['Acme Cycles']);
  });

  it('shows every crumb and separator from md on', () => {
    const trail = renderRecordTrail();
    for (const viewport of [768, 1024]) {
      const shown = [...trail.querySelectorAll('li')].filter((item) => shownAt(item, viewport));
      expect(shown.map((item) => item.textContent)).toEqual(['Home', '', 'Customers', '', 'Acme Cycles']);
    }
  });
});
