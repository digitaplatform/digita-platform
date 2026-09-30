// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useI18nStore } from '@/stores/i18n';

/**
 * A card's width widens it on the dashboard grid at the three-column breakpoint. The span sits
 * on the grid item, the element the grid lays out: on the card inside it, a span does nothing.
 * A chart or a list card is two columns wide unless it names its own width; any other card is
 * one, and a card keeps its width while it waits for its data.
 */

const fixtures = vi.hoisted(() => ({
  workspace: {
    _id: 'library-home',
    name: 'Library',
    default_view: 'library-overview',
    cards: [
      { id: 'one', kind: 'number', label: 'One column', section: 'book_count', value_field: 'total', width: 1 },
      { id: 'two', kind: 'number', label: 'Two columns', section: 'book_count', value_field: 'total', width: 2 },
      { id: 'three', kind: 'number', label: 'Three columns', section: 'book_count', value_field: 'total', width: 3 },
      { id: 'no-width', kind: 'number', label: 'No width', section: 'book_count', value_field: 'total' },
      { id: 'genres', kind: 'chart', label: 'Books per genre', section: 'per_genre', chart_type: 'bar', x_field: 'genre', y_fields: ['books'] },
      { id: 'recent', kind: 'list', label: 'Recently added', section: 'recent_books', columns: ['title'] },
      { id: 'small-chart', kind: 'chart', label: 'Small chart', section: 'per_genre', chart_type: 'bar', x_field: 'genre', y_fields: ['books'], width: 1 },
    ],
  },
  view: {
    _id: 'library-overview',
    name: 'library-overview',
    anchored: false,
    sections: [
      { key: 'book_count', kind: 'aggregate', entity: 'Book', pipeline: [] },
      { key: 'per_genre', kind: 'aggregate', entity: 'Book', pipeline: [] },
      { key: 'recent_books', kind: 'list', entity: 'Book' },
    ],
  },
  meta: {
    name: 'Book',
    label: 'Book',
    fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
  },
  sections: {
    book_count: { total: 3 },
    per_genre: [],
    recent_books: [{ _id: 'b1', title: 'Der Process' }],
  },
}));

// Holds the view's data back until the test opens it.
const viewGate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: { roles: ['Librarian'] }, default_workspace: 'library-home', locale: { format_locale: 'en-US' } }),
}));
vi.mock('@/hooks/useWorkspaceCatalog', () => ({
  useWorkspaceCatalog: () => ({ isLoading: false, visible: [{ _id: 'library-home' }] }),
}));
vi.mock('@/services/resource', () => ({
  getDoc: async (entity: string) => ({
    success: true,
    data: structuredClone(entity === 'Workspace' ? fixtures.workspace : fixtures.view),
  }),
  getView: async () => {
    await viewGate.opened;
    return { success: true, data: { source: null, sections: fixtures.sections }, messages: [] };
  },
}));
vi.mock('@/services/meta', () => ({
  getEntityMeta: async () => ({ success: true, data: fixtures.meta }),
}));

import DashboardPage from '@/pages/DashboardPage';

// jsdom has no ResizeObserver; a chart card measures its own width with one.
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = origRO;
});

function renderDashboard() {
  useI18nStore.setState({ locale: 'en', translations: {}, loaded: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

/** Each grid item's card heading with the column spans on the item itself. */
function gridItemSpans(grid: Element): Array<[string, string[]]> {
  return [...grid.children].map((item) => [
    item.querySelector('h3')?.textContent ?? '',
    [...item.classList].filter((name) => name.includes('col-span')),
  ]);
}

const EXPECTED_SPANS: Array<[string, string[]]> = [
  ['One column', ['lg:col-span-1']],
  ['Two columns', ['lg:col-span-2']],
  ['Three columns', ['lg:col-span-3']],
  ['No width', ['lg:col-span-1']],
  ['Books per genre', ['lg:col-span-2']],
  ['Recently added', ['lg:col-span-2']],
  ['Small chart', ['lg:col-span-1']],
];

describe('the width of a dashboard card', () => {
  it('spans the grid item over as many columns as the card is wide', async () => {
    renderDashboard();

    // The workspace is there, the view's data is not: every view-bound card is loading.
    const grid = (await screen.findByRole('heading', { name: 'One column' })).closest('.grid')!;
    expect(screen.getAllByRole('status')).toHaveLength(EXPECTED_SPANS.length);
    expect(gridItemSpans(grid)).toEqual(EXPECTED_SPANS);

    viewGate.open();
    // Every card has its data: the number cards show their value, the list card its table.
    await screen.findByRole('table');
    expect(screen.getAllByText('3')).toHaveLength(4);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(gridItemSpans(grid)).toEqual(EXPECTED_SPANS);

    // The card inside a grid item carries no span of its own.
    const cardSpans = [...grid.children].map((item) => item.firstElementChild?.className.includes('col-span'));
    expect(cardSpans).toEqual(EXPECTED_SPANS.map(() => false));
  });
});
