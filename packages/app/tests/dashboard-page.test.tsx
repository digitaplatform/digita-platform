// @vitest-environment jsdom
// A workshop lead opens the dashboard each morning: open work orders, a chart of the week, what is
// due, shortcuts and links. The page resolves each card's view section and renderCard draws the card
// of its kind, so a broken page or card would leave the lead with an empty page or a broken tile.
// Every kind is drawn here from mocked view data, with its value, its label and where it leads.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fixtures = vi.hoisted(() => {
  const goodCards = [
    { id: 'open-orders', kind: 'number', label: 'Open work orders', section: 'open_orders', value_field: 'total', deep_link: '/WorkOrder?status=Open' },
    { id: 'orders-week', kind: 'chart', label: 'Orders this week', section: 'orders_by_day', chart_type: 'bar', x_field: 'day', y_fields: ['orders'] },
    { id: 'due-today', kind: 'list', label: 'Due today', section: 'due_today', columns: ['title', 'customer'], deep_link: '/WorkOrder?assignee=$user.email' },
    {
      id: 'new-order',
      kind: 'shortcut',
      label: 'New work order',
      to: '/WorkOrder/new',
      description: 'Opens an empty work order.',
      count_view: 'workshop-overview',
      count_section: 'open_orders',
      count_field: 'total',
    },
    {
      id: 'reports',
      kind: 'links',
      label: 'Reports',
      links: [
        { label: 'All invoices', to: '/Invoice' },
        { label: 'Bike catalog', href: 'https://catalog.example/bikes' },
      ],
    },
  ];
  return {
    workspaces: {
      'workshop-home': { _id: 'workshop-home', name: 'Workshop', default_view: 'workshop-overview', cards: goodCards },
      'broken-home': {
        _id: 'broken-home',
        name: 'Broken',
        default_view: 'workshop-overview',
        cards: [
          { id: 'fine', kind: 'number', label: 'Fine card', section: 'open_orders', value_field: 'total' },
          { id: 'broken', kind: 'number', label: 'Broken card', view: 'broken-view', section: 'open_orders', value_field: 'total' },
        ],
      },
      'quiet-home': {
        _id: 'quiet-home',
        name: 'Quiet',
        default_view: 'workshop-overview',
        cards: [
          { id: 'none-number', kind: 'number', label: 'Nothing open', section: 'nothing', value_field: 'total' },
          { id: 'none-chart', kind: 'chart', label: 'Nothing charted', section: 'nothing_rows', chart_type: 'line', x_field: 'day', y_fields: ['orders'] },
          { id: 'none-list', kind: 'list', label: 'Nothing due', section: 'nothing_rows', columns: ['title'] },
        ],
      },
    } as Record<string, unknown>,
    views: {
      'workshop-overview': {
        sections: {
          open_orders: { total: 12 },
          orders_by_day: [
            { day: 'Mon', orders: 3 },
            { day: 'Tue', orders: 5 },
            { day: 'Wed', orders: 2 },
          ],
          due_today: [
            { _id: 'w1', title: 'Brake service', customer: 'Acme' },
            { _id: 'w2', title: 'Chain swap', customer: 'Globex' },
          ],
          nothing_rows: [],
        },
      },
    } as Record<string, unknown>,
    current: { workspace: 'workshop-home' },
  };
});

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({
      user: { email: 'mia@shop.example', roles: ['Mechanic'] },
      default_workspace: fixtures.current.workspace,
      locale: { format_locale: 'en-GB' },
      settings: { default_currency: 'CHF' },
    }),
}));
vi.mock('@/hooks/useWorkspaceCatalog', () => ({
  useWorkspaceCatalog: () => ({ isLoading: false, visible: [{ _id: fixtures.current.workspace }] }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));
vi.mock('@/services/resource', () => ({
  getDoc: async (entity: string, name: string) => {
    if (entity === 'Workspace') return { success: true, data: structuredClone(fixtures.workspaces[name]) };
    return {
      success: true,
      data: {
        name,
        sections: [
          { key: 'due_today', kind: 'list', entity: 'WorkOrder' },
          { key: 'nothing_rows', kind: 'list', entity: 'WorkOrder' },
        ],
      },
    };
  },
  getView: async (name: string) => {
    if (name === 'broken-view') return { success: false, status_code: 500, error: { detail: 'The view is broken' } };
    return { success: true, data: { source: null, ...structuredClone(fixtures.views[name] as object) }, messages: [] };
  },
}));
vi.mock('@/services/meta', () => ({
  getEntityMeta: async () => ({
    success: true,
    data: {
      name: 'WorkOrder',
      label: 'Work order',
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title' },
        { fieldname: 'customer', fieldtype: 'Data', label: 'Customer' },
      ],
    },
  }),
}));

import DashboardPage from '@/pages/DashboardPage';

// The chart reads the size of its frame through a ResizeObserver, which jsdom has no layout for.
// getBoundingClientRect is left alone: the axes and the legend measure their own text with it, and
// a card-sized answer for each of them would leave no room for the plot.
const origRO = globalThis.ResizeObserver;
beforeAll(async () => {
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb([{ target, contentRect: { width: 600, height: 192 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // The card loads the chart lazily; loading it here keeps the waits below short.
  await import('@/components/dashboard/ChartCanvas');
});
afterAll(() => {
  globalThis.ResizeObserver = origRO;
});

function drawDashboard(workspace: string) {
  fixtures.current.workspace = workspace;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

function findCard(label: string): HTMLElement {
  return screen.getByRole('heading', { name: label }).closest<HTMLElement>('[data-ui="card"]')!;
}

beforeEach(() => navigate.mockReset());

describe('the dashboard page with one card of each kind', () => {
  it('heads the page with the workspace name', async () => {
    drawDashboard('workshop-home');
    expect(await screen.findByRole('heading', { level: 1, name: 'Workshop' })).toBeInTheDocument();
  });

  it('draws the number card with its label, its value and the link of its value', async () => {
    const user = userEvent.setup();
    drawDashboard('workshop-home');
    await screen.findByRole('heading', { name: 'Open work orders' });
    const card = within(findCard('Open work orders'));
    const value = await card.findByRole('button', { name: '12' });

    await user.click(value);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/WorkOrder?status=Open');
  });

  it('draws the chart card with its label and one bar per row, as tall as the value of the row', async () => {
    drawDashboard('workshop-home');
    await screen.findByRole('heading', { name: 'Orders this week' });
    const card = findCard('Orders this week');
    await vi.waitFor(() => expect(card.querySelector('svg.recharts-surface')).not.toBeNull());
    const heights = [...card.querySelectorAll('.recharts-bar-rectangle path')].map((bar) => Number(bar.getAttribute('height')));
    const orders = (fixtures.views['workshop-overview'] as { sections: { orders_by_day: Array<{ orders: number }> } }).sections.orders_by_day.map(
      (row) => row.orders,
    );
    expect(heights).toHaveLength(orders.length);
    orders.forEach((count, index) => expect(heights[index]! / heights[0]!).toBeCloseTo(count / orders[0]!, 2));
  });

  it('draws the list card with its label, the field labels as headers, the rows and the link of a row', async () => {
    const user = userEvent.setup();
    drawDashboard('workshop-home');
    await screen.findByRole('heading', { name: 'Due today' });
    const card = within(findCard('Due today'));
    const table = await card.findByRole('table');

    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Title', 'Customer']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['Brake service', 'Acme'],
      ['Chain swap', 'Globex'],
    ]);

    await user.click(within(table).getByText('Chain swap'));
    expect(navigate).toHaveBeenCalledWith('/WorkOrder?assignee=mia@shop.example');
  });

  it('draws the shortcut card with its label, its description, its count and its target', async () => {
    const user = userEvent.setup();
    drawDashboard('workshop-home');
    const shortcut = await screen.findByRole('button', { name: /New work order/ });
    expect(within(shortcut).getByText('Opens an empty work order.')).toBeInTheDocument();
    expect(within(shortcut).getByText('12')).toBeInTheDocument();

    await user.click(shortcut);

    expect(navigate).toHaveBeenCalledWith('/WorkOrder/new');
  });

  it('draws the links card with its label, an in-app link that navigates and an external link that opens a new tab', async () => {
    const user = userEvent.setup();
    drawDashboard('workshop-home');
    await screen.findByRole('heading', { name: 'Reports' });
    const card = within(findCard('Reports'));

    await user.click(card.getByRole('button', { name: 'All invoices' }));
    expect(navigate).toHaveBeenCalledWith('/Invoice');

    const external = card.getByRole('link', { name: 'Bike catalog' });
    expect(external).toHaveAttribute('href', 'https://catalog.example/bikes');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('a card whose view cannot be read', () => {
  it('shows the error state of that card and leaves its sibling cards alone', async () => {
    drawDashboard('broken-home');
    await screen.findByRole('heading', { name: 'Broken card' });

    const broken = within(findCard('Broken card'));
    const alert = await broken.findByRole('alert');
    expect(alert).toHaveTextContent('ui.dashboard.cardError');
    expect(broken.queryByText('12')).toBeNull();

    const fine = within(findCard('Fine card'));
    expect(await fine.findByText('12')).toBeInTheDocument();
    expect(fine.queryByRole('alert')).toBeNull();
  });
});

describe('a card with no rows', () => {
  it.each([
    ['number', 'Nothing open'],
    ['chart', 'Nothing charted'],
    ['list', 'Nothing due'],
  ])('shows the empty state of the %s card, a dash, where a value or a row would be', async (_kind, label) => {
    drawDashboard('quiet-home');
    await screen.findByRole('heading', { name: label });
    const card = findCard(label);
    await vi.waitFor(() => expect(within(card).getByText('—')).toBeInTheDocument());
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(within(card).queryByRole('table')).toBeNull();
    expect(card.querySelector('svg')).toBeNull();
  });
});
