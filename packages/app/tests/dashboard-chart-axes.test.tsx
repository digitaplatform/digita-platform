// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useI18nStore } from '@/stores/i18n';

/**
 * A dashboard chart draws its grid, axes, tooltip and legend around its series. The legend names
 * each series by the translated label of its field on the entity the card's section reads; a key
 * no field has names its series as it is. The chart waits for the labels, so its legend never
 * shows a key a label replaces.
 */

const fixtures = vi.hoisted(() => ({
  workspace: {
    _id: 'shop-home',
    name: 'Shop',
    default_view: 'shop-overview',
    cards: [
      { id: 'orders', kind: 'number', label: 'Orders', section: 'order_count', value_field: 'total' },
      { id: 'sales-bars', kind: 'chart', label: 'Sales in bars', section: 'monthly_sales', chart_type: 'bar', x_field: 'month', y_fields: ['revenue', 'units', 'returns'] },
      { id: 'sales-lines', kind: 'chart', label: 'Sales in lines', section: 'monthly_sales', chart_type: 'line', x_field: 'month', y_fields: ['revenue', 'units', 'returns'] },
      { id: 'sales-areas', kind: 'chart', label: 'Sales in areas', section: 'monthly_sales', chart_type: 'area', x_field: 'month', y_fields: ['revenue', 'units', 'returns'] },
    ],
  },
  entities: { order_count: 'Order', monthly_sales: 'Order' },
  meta: {
    name: 'Order',
    label: 'Order',
    fields: [
      { fieldname: 'revenue', fieldtype: 'Currency', label: 'Revenue' },
      { fieldname: 'units', fieldtype: 'Int', label: 'Units' },
    ],
  },
  sections: {
    order_count: { total: 55 },
    monthly_sales: [
      { month: 'Jan', revenue: 1200, units: 30, returns: 2 },
      { month: 'Feb', revenue: 900, units: 25, returns: 1 },
    ],
  },
}));

// Open unless a test closes it: then the entity metadata waits until the test opens it again.
const metaGate = vi.hoisted(() => ({ opened: Promise.resolve(), open: () => {} }));
function closeMetaGate() {
  metaGate.opened = new Promise<void>((resolve) => (metaGate.open = resolve));
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { roles: ['Seller'] }, default_workspace: 'shop-home', locale: { format_locale: 'en-US' } }),
}));
vi.mock('@/hooks/useWorkspaceCatalog', () => ({
  useWorkspaceCatalog: () => ({ isLoading: false, visible: [{ _id: 'shop-home' }] }),
}));
vi.mock('@/services/resource', () => ({
  getDoc: async () => ({ success: true, data: structuredClone(fixtures.workspace) }),
  getView: async () => ({
    success: true,
    data: { source: null, sections: fixtures.sections, entities: fixtures.entities },
    messages: [],
  }),
}));
vi.mock('@/services/meta', () => ({
  getEntityMeta: async () => {
    await metaGate.opened;
    return { success: true, data: fixtures.meta };
  },
}));

import DashboardPage from '@/pages/DashboardPage';

// jsdom lays nothing out: every observed element reports the size of a wide chart card, which the
// card and recharts' ResponsiveContainer both read.
const origRO = globalThis.ResizeObserver;
beforeAll(async () => {
  globalThis.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const entry = { target, contentRect: { width: 600, height: 192 } };
      this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // The card loads its recharts canvas lazily; loading it here keeps the waits below short.
  await import('@/components/dashboard/ChartCanvas');
});
afterAll(() => {
  globalThis.ResizeObserver = origRO;
});

function renderDashboard(translations: Record<string, string>) {
  useI18nStore.setState({ locale: 'de', translations, loaded: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

/** The grid item of the card headed `label`. */
function card(label: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: label });
  const item = [...heading.closest('.grid')!.children].find((child) => child.contains(heading));
  return item as HTMLElement;
}

function texts(root: Element, selector: string): Array<string | null> {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent);
}

/** Each chart card with the class recharts gives one of its series. */
const CHARTS = [
  ['Sales in bars', '.recharts-bar'],
  ['Sales in lines', '.recharts-line'],
  ['Sales in areas', '.recharts-area'],
] as const;

describe('a dashboard chart', () => {
  it('draws its grid, axes, tooltip and legend around the series', async () => {
    renderDashboard({});

    await screen.findByRole('heading', { name: 'Sales in bars' });
    for (const [label, series] of CHARTS) {
      const chart = card(label);
      await waitFor(() => expect(chart.querySelectorAll(series)).toHaveLength(3));

      const xAxis = chart.querySelector('.recharts-xAxis');
      expect(xAxis, label).not.toBeNull();
      expect(texts(xAxis!, '.recharts-cartesian-axis-tick-value')).toEqual(['Jan', 'Feb']);
      expect(chart.querySelector('.recharts-yAxis'), label).not.toBeNull();
      expect(chart.querySelector('.recharts-cartesian-grid'), label).not.toBeNull();
      expect(chart.querySelector('.recharts-tooltip-wrapper'), label).not.toBeNull();
      expect(texts(chart, '.recharts-legend-item-text'), label).toHaveLength(3);
    }
  });

  it('names each series by the translated label of its field, once the labels are there', async () => {
    closeMetaGate();
    renderDashboard({ 'field.Order.revenue': 'Umsatz' });

    // The rows are there once the number card shows its value; the charts wait for the labels.
    expect(await screen.findByText('55')).toBeInTheDocument();
    for (const [label] of CHARTS) {
      expect(within(card(label)).getByRole('status')).toBeInTheDocument();
      expect(card(label).querySelector('.recharts-wrapper'), label).toBeNull();
    }

    metaGate.open();
    // A translated label; the field's own label where the language has none; the key where the
    // entity has no such field.
    for (const [label] of CHARTS) {
      await waitFor(() =>
        expect(texts(card(label), '.recharts-legend-item-text'), label).toEqual(['Umsatz', 'Units', 'returns']),
      );
    }
  });
});
