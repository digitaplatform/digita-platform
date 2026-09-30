// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useI18nStore } from '@/stores/i18n';

/**
 * A dashboard speaks the session language: the heading, every card text and a list card's column
 * headers come from the app's translation map, keyed by the workspace `_id` and the card `id`,
 * and a column header is the translated label of the field it shows, read on the entity of the
 * card's view section. A text without a key stays as the workspace row writes it.
 */

const fixtures = vi.hoisted(() => ({
  workspace: {
    _id: 'library-home',
    name: 'Library',
    default_view: 'library-overview',
    cards: [
      { id: 'books-total', kind: 'number', label: 'Books', section: 'book_count', value_field: 'total' },
      { id: 'recent-books', kind: 'list', label: 'Recently added', section: 'recent_books', columns: ['title', 'isbn', 'score'] },
      { id: 'add-book', kind: 'shortcut', label: 'Add a book', to: '/Book/new', description: 'Opens an empty book form.' },
      { id: 'help', kind: 'links', label: 'Help', links: [{ label: 'All books', to: '/Book' }, { label: 'Library of Congress', href: 'https://www.loc.gov/' }] },
    ],
  },
  view: {
    _id: 'library-overview',
    name: 'library-overview',
    anchored: false,
    sections: [
      { key: 'book_count', kind: 'aggregate', entity: 'Book', pipeline: [] },
      { key: 'recent_books', kind: 'list', entity: 'Book' },
    ],
  },
  meta: {
    Book: {
      name: 'Book',
      label: 'Book',
      fields: [
        { fieldname: 'title', fieldtype: 'Data', label: 'Title' },
        { fieldname: 'isbn', fieldtype: 'Data', label: 'ISBN' },
      ],
    },
  } as Record<string, unknown>,
  sections: {
    book_count: { total: 3 },
    recent_books: [{ _id: 'b1', title: 'Der Process', isbn: '978-3', score: 5 }],
  },
}));

// Holds the entity metadata back until the test opens it.
const metaGate = vi.hoisted(() => {
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
    sel({ user: { roles: ['Librarian'] }, default_workspace: 'library-home', locale: { format_locale: 'de-CH' } }),
}));
vi.mock('@/hooks/useWorkspaceCatalog', () => ({
  useWorkspaceCatalog: () => ({ isLoading: false, visible: [{ _id: 'library-home' }] }),
}));
vi.mock('@/services/resource', () => ({
  getDoc: async (entity: string) => ({
    success: true,
    data: structuredClone(entity === 'Workspace' ? fixtures.workspace : fixtures.view),
  }),
  getView: async () => ({ success: true, data: { source: null, sections: fixtures.sections }, messages: [] }),
}));
vi.mock('@/services/meta', () => ({
  getEntityMeta: async (entity: string) => {
    await metaGate.opened;
    return { success: true, data: fixtures.meta[entity] };
  },
}));

import DashboardPage from '@/pages/DashboardPage';

function renderDashboard(translations: Record<string, string>) {
  useI18nStore.setState({ locale: 'de', translations, loaded: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe('the dashboard in the session language', () => {
  it('shows the German heading, card texts and list headers', async () => {
    renderDashboard({
      'workspace.library-home.name': 'Bibliothek',
      'workspace.library-home.card.recent-books.label': 'Neu hinzugefügt',
      'workspace.library-home.card.add-book.label': 'Buch erfassen',
      'workspace.library-home.card.add-book.description': 'Öffnet ein leeres Buchformular.',
      'workspace.library-home.card.help.label': 'Hilfe',
      'workspace.library-home.card.help.link.0.label': 'Alle Bücher',
      'field.Book.title': 'Titel',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Bibliothek' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Neu hinzugefügt' })).toBeInTheDocument();
    expect(screen.getByText('Buch erfassen')).toBeInTheDocument();
    expect(screen.getByText('Öffnet ein leeres Buchformular.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hilfe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alle Bücher' })).toBeInTheDocument();
    // No key: the text the workspace row writes.
    expect(screen.getByRole('heading', { name: 'Books' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Library of Congress' })).toBeInTheDocument();

    // The rows are there once the number card shows its value; the list card waits for the
    // labels instead of heading its columns with the keys.
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    metaGate.open();

    // A translated field label; the field's own label where the language has none; the key
    // where the section's entity has no such field.
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Titel', 'ISBN', 'score']);
  });
});
