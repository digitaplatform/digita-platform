// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ChartCard as ChartCardDef } from '@digitaplatform/shared';
import type { ChartCanvasProps } from '@/components/dashboard/ChartCanvas';

/**
 * A chart card draws in the colors of the active design and drops its legend and axes when it is
 * narrow. It reads both off its chart host, which exists only once the card has data: a card that
 * mounts while its view loads measures when the data arrives, and again when the mode flips or
 * the card resizes.
 */

vi.mock('@/services/userPreference', () => ({
  getUserPreference: vi.fn().mockResolvedValue(undefined),
  setUserPreference: vi.fn().mockResolvedValue(undefined),
}));
// The canvas shows what the card hands it; drawing it is recharts' part.
vi.mock('@/components/dashboard/ChartCanvas', () => ({
  default: ({ colors, gridColor, compact }: ChartCanvasProps) => (
    <div data-testid="chart-canvas" data-colors={colors.join(' ')} data-grid-color={gridColor} data-compact={String(compact)} />
  ),
}));

import { ChartCard } from '@/components/dashboard';
import { useThemeStore } from '@/stores/theme';

const CARD: ChartCardDef = {
  id: 'genres',
  kind: 'chart',
  label: 'Books per genre',
  section: 'per_genre',
  chart_type: 'bar',
  x_field: 'genre',
  y_fields: ['books'],
};
const ROWS = [
  { genre: 'poetry', books: 2 },
  { genre: 'mystery', books: 1 },
];

// A design the card must follow, in the order the card takes its series colors.
const PALETTE_VARS = [
  '--color-primary-600',
  '--color-accent-500',
  '--color-primary-400',
  '--color-accent-700',
  '--color-primary-800',
  '--color-accent-300',
];
const LIGHT = ['#0f766e', '#b45309', '#2dd4bf', '#92400e', '#115e59', '#fcd34d'];
const DARK = ['#5eead4', '#fbbf24', '#99f6e4', '#fde68a', '#ccfbf1', '#78350f'];
const LIGHT_BORDER = '#e7e5e4';
const DARK_BORDER = '#44403c';

function designRule(selector: string, palette: string[], border: string): string {
  const colors = PALETTE_VARS.map((name, i) => `${name}: ${palette[i]};`).join(' ');
  return `${selector} { ${colors} --color-border: ${border}; }`;
}

// jsdom lays nothing out: the stub reports the width the test gives the card, once when it starts
// to observe, as a browser does, and again on every resize the test makes.
let cardWidth = 0;
const observers = new Set<{ report: () => void }>();
const origRO = globalThis.ResizeObserver;
let design: HTMLStyleElement;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private targets: Element[] = [];
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.push(target);
      observers.add(this);
      this.report();
    }
    unobserve() {}
    disconnect() {
      observers.delete(this);
    }
    report() {
      const entries = this.targets.map((target) => ({ target, contentRect: { width: cardWidth, height: 192 } }));
      this.callback(entries as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
  } as unknown as typeof ResizeObserver;
  design = document.createElement('style');
  design.textContent = `${designRule('.design', LIGHT, LIGHT_BORDER)} ${designRule('.dark .design', DARK, DARK_BORDER)}`;
  document.head.appendChild(design);
  useThemeStore.getState().setMode('light');
});
afterAll(() => {
  globalThis.ResizeObserver = origRO;
  design.remove();
});

function resizeCard(width: number) {
  cardWidth = width;
  act(() => observers.forEach((observer) => observer.report()));
}

describe('the colors and the width of a chart card', () => {
  it('are measured once the chart exists, and again on a mode flip and a resize', async () => {
    cardWidth = 240;
    const { rerender } = render(
      <div className="design">
        <ChartCard card={CARD} status="loading" data={null} />
      </div>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();

    rerender(
      <div className="design">
        <ChartCard card={CARD} status="ready" data={ROWS} />
      </div>,
    );
    const canvas = await screen.findByTestId('chart-canvas');
    expect(canvas.dataset.colors).toBe(LIGHT.join(' '));
    expect(canvas.dataset.gridColor).toBe(LIGHT_BORDER);
    expect(canvas.dataset.compact).toBe('true');

    act(() => useThemeStore.getState().setMode('dark'));
    expect(canvas.dataset.colors).toBe(DARK.join(' '));
    expect(canvas.dataset.gridColor).toBe(DARK_BORDER);

    resizeCard(480);
    expect(canvas.dataset.compact).toBe('false');
    resizeCard(300);
    expect(canvas.dataset.compact).toBe('true');
  });
});
