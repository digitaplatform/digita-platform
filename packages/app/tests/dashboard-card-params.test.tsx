// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useI18nStore } from '@/stores/i18n';

/**
 * A view-bound card sends its params to its view, so two cards on one view can show different
 * data. The page asks once per distinct view and params pair: cards with the same params, in any
 * key order, share one request, and a card without params reads the view as it is. A shortcut
 * that names only its count section counts on the default view without params, also when every
 * other card on that view sends some.
 */

const fixtures = vi.hoisted(() => ({
  workspace: {
    _id: 'library-home',
    name: 'Library',
    default_view: 'library-overview',
    cards: [
      { id: 'poetry', kind: 'number', label: 'Poetry', section: 'book_count', value_field: 'total', params: { genre: 'poetry' } },
      { id: 'mystery', kind: 'number', label: 'Mystery', section: 'book_count', value_field: 'total', params: { genre: 'mystery' } },
      { id: 'all', kind: 'shortcut', label: 'All books', to: '/Book', count_section: 'book_count', count_field: 'total' },
      { id: 'german-poetry', kind: 'list', label: 'Poetry in German', section: 'recent_books', columns: ['title'], params: { genre: 'poetry', lang: 'de' } },
      { id: 'german-poems', kind: 'number', label: 'Poems in German', section: 'book_count', value_field: 'total', params: { lang: 'de', genre: 'poetry' } },
    ],
  },
  view: {
    _id: 'library-overview',
    name: 'library-overview',
    anchored: false,
    params: [
      { name: 'genre', type: 'string' },
      { name: 'lang', type: 'string' },
    ],
    sections: [
      { key: 'book_count', kind: 'aggregate', entity: 'Book', pipeline: [] },
      { key: 'recent_books', kind: 'list', entity: 'Book' },
    ],
  },
  meta: {
    name: 'Book',
    label: 'Book',
    fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
  },
  books: [
    { _id: 'b1', title: 'Gedichte', genre: 'poetry', lang: 'de' },
    { _id: 'b2', title: 'Leaves of Grass', genre: 'poetry', lang: 'en' },
    { _id: 'b3', title: 'The Hound of the Baskervilles', genre: 'mystery', lang: 'en' },
  ] as Array<Record<string, string>>,
}));

// The view as the engine runs it: each param narrows the books its sections read.
const getView = vi.hoisted(() =>
  vi.fn(async (_name: string, params?: Record<string, string | number | boolean>) => {
    const books = fixtures.books.filter((book) =>
      Object.entries(params ?? {}).every(([key, value]) => book[key] === value),
    );
    return {
      success: true,
      data: { source: null, sections: { book_count: { total: books.length }, recent_books: books } },
      messages: [],
    };
  }),
);

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
  getView,
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

/** The grid item of the card headed `label`. */
function card(label: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: label });
  const item = [...heading.closest('.grid')!.children].find((child) => child.contains(heading));
  return item as HTMLElement;
}

describe('the params of a dashboard card', () => {
  it('reach the view, once per distinct view and params pair', async () => {
    renderDashboard();

    // The list card waits for its data and its labels; then every card has its data.
    await screen.findByRole('heading', { name: 'Poetry in German' });
    const table = await within(card('Poetry in German')).findByRole('table');
    expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Gedichte']);
    expect(within(card('Poetry')).getByText('2')).toBeInTheDocument();
    expect(within(card('Mystery')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /^All books/ })).getByText('3')).toBeInTheDocument();
    expect(within(card('Poems in German')).getByText('1')).toBeInTheDocument();

    expect(getView.mock.calls.map(([name, params]) => [name, params ?? null])).toEqual([
      ['library-overview', { genre: 'poetry' }],
      ['library-overview', { genre: 'mystery' }],
      ['library-overview', null],
      ['library-overview', { genre: 'poetry', lang: 'de' }],
    ]);
  });
});
