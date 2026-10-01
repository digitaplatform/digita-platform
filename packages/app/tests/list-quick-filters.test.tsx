// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { ListParams } from '@/services/resource';

/**
 * An author flags the fields a person filters by most with in_standard_filter, and the list
 * draws a control for each of them above its rows: a filter on such a field takes one pick
 * or a few typed letters, not a trip through the filter panel. The page runs on the real
 * data router, as the app does, so the URL and the requests are the ones a person's input
 * produces.
 */

const getList = vi.hoisted(() => vi.fn<(entity: string, params: ListParams) => Promise<unknown>>());
const shown = vi.hoisted(() => ({ meta: undefined as unknown }));

const BOOK = {
  name: 'Book',
  label: 'Book',
  title_field: 'title',
  fields: [
    { fieldname: 'title', fieldtype: 'Data', label: 'Title', in_standard_filter: true },
    { fieldname: 'genre', fieldtype: 'Select', label: 'Genre', options: 'Novel\nPoetry', in_standard_filter: true },
    { fieldname: 'in_stock', fieldtype: 'Check', label: 'In stock', in_standard_filter: true },
    { fieldname: 'publisher', fieldtype: 'Link', label: 'Publisher', target: 'Publisher', in_standard_filter: true },
    { fieldname: 'year', fieldtype: 'Int', label: 'Year', in_standard_filter: true },
    { fieldname: 'due_at', fieldtype: 'Datetime', label: 'Due at', in_standard_filter: true },
    { fieldname: 'pages', fieldtype: 'Int', label: 'Pages' },
  ],
  permissions: [],
} as unknown as EntityDefinition;

vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  getList,
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: shown.meta, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: [{ _id: 'P-1', display: 'Penguin' }], isLoading: false }),
}));
vi.mock('@/hooks/useListPreferences', () => ({
  useListPreferences: () => ({
    views: [],
    defaultView: undefined,
    isLoading: false,
    isAdmin: false,
    canEdit: () => false,
  }),
}));
vi.mock('@/hooks/useRealtime', () => ({ useRealtimeEntity: () => undefined }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
const LOCALE = { code: 'en', format_locale: 'en-GB', timezone: 'Europe/Zurich' };
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: typeof LOCALE }) => unknown) =>
    sel({ user: { roles: ['Librarian'] }, locale: LOCALE }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tField: (_e: string, _f: string, fb?: string) => fb ?? '',
      tOption: (_e: string, _f: string, v: string) => `${v} (text)`,
      tEntity: (e: string, fb?: string) => fb ?? e,
    }),
}));

import ListPage from '@/pages/ListPage';

function renderList(initialPath: string) {
  const router = createMemoryRouter([{ path: '/:entity', element: <ListPage /> }], {
    initialEntries: [initialPath],
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** The AND filters the URL holds. */
function urlFilters(router: ReturnType<typeof renderList>): unknown[] {
  const raw = new URLSearchParams(router.state.location.search).get('f');
  return raw ? (JSON.parse(raw) as unknown[]) : [];
}

/** The AND filters of the last list request. */
function lastRequestedFilters(): unknown[] {
  return getList.mock.lastCall?.[1].filters ?? [];
}

function quickFilters(): HTMLElement {
  return screen.getByRole('group', { name: 'ui.filter.title' });
}

async function pick(user: ReturnType<typeof userEvent.setup>, control: string, option: string): Promise<void> {
  await user.click(within(quickFilters()).getByRole('combobox', { name: control }));
  await user.click(await screen.findByRole('option', { name: option }));
}

beforeEach(() => {
  shown.meta = BOOK;
  getList.mockReset();
  getList.mockResolvedValue({ data: [], meta: { total: 0, page: 1, page_size: 20, total_pages: 0 } });
});

describe('the quick filters of a list', () => {
  it('are one control for each field flagged in_standard_filter, and none for the others', async () => {
    renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    const row = quickFilters();
    expect(within(row).getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(within(row).getByRole('combobox', { name: 'Genre' })).toBeInTheDocument();
    expect(within(row).getByRole('combobox', { name: 'In stock' })).toBeInTheDocument();
    expect(within(row).getByRole('combobox', { name: 'Publisher' })).toBeInTheDocument();
    expect(within(row).getByRole('spinbutton', { name: 'Year' })).toBeInTheDocument();
    expect(within(row).queryByRole('spinbutton', { name: 'Pages' })).not.toBeInTheDocument();
    expect(within(row).queryByText('Pages')).not.toBeInTheDocument();
  });

  it('filter by a picked option of a Select field', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await pick(user, 'Genre', 'Poetry (text)');

    await waitFor(() => expect(urlFilters(router)).toEqual([['genre', '=', 'Poetry']]));
    await waitFor(() => expect(lastRequestedFilters()).toEqual([['genre', '=', 'Poetry']]));
  });

  it('filter by the text typed into a text field, as the panel does: contains', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await user.type(within(quickFilters()).getByRole('textbox', { name: 'Title' }), 'dune');

    await waitFor(() => expect(urlFilters(router)).toEqual([['title', 'like', 'dune']]));
    await waitFor(() => expect(lastRequestedFilters()).toEqual([['title', 'like', 'dune']]));
  });

  it('filter a number field by the number typed, not by its text', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await user.type(within(quickFilters()).getByRole('spinbutton', { name: 'Year' }), '1965');

    await waitFor(() => expect(urlFilters(router)).toEqual([['year', '=', 1965]]));
  });

  it('filter a Check field by yes, as 1', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await pick(user, 'In stock', 'ui.filter.yes');

    await waitFor(() => expect(urlFilters(router)).toEqual([['in_stock', '=', 1]]));
  });

  it('filter a Link field by the record a person searches and picks', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await user.click(within(quickFilters()).getByRole('combobox', { name: 'Publisher' }));
    await user.click(await screen.findByRole('option', { name: 'Penguin' }));

    await waitFor(() => expect(urlFilters(router)).toEqual([['publisher', '=', 'P-1']]));
  });

  it('show the applied filter of their field, and take it away for no value, keeping the others', async () => {
    const user = userEvent.setup();
    const applied = [
      ['genre', '=', 'Poetry'],
      ['pages', '>', 100],
    ];
    const router = renderList(`/Book?f=${encodeURIComponent(JSON.stringify(applied))}`);
    await waitFor(() => expect(lastRequestedFilters()).toEqual(applied));

    expect(within(quickFilters()).getByRole('combobox', { name: 'Genre' })).toHaveTextContent('Poetry (text)');
    await pick(user, 'Genre', '—');

    await waitFor(() => expect(urlFilters(router)).toEqual([['pages', '>', 100]]));
    await waitFor(() => expect(lastRequestedFilters()).toEqual([['pages', '>', 100]]));
  });

  it('change the applied filter of their field where it stands', async () => {
    const user = userEvent.setup();
    const applied = [
      ['genre', '=', 'Novel'],
      ['pages', '>', 100],
    ];
    const router = renderList(`/Book?f=${encodeURIComponent(JSON.stringify(applied))}`);
    await waitFor(() => expect(lastRequestedFilters()).toEqual(applied));

    await pick(user, 'Genre', 'Poetry (text)');

    await waitFor(() =>
      expect(urlFilters(router)).toEqual([
        ['genre', '=', 'Poetry'],
        ['pages', '>', 100],
      ]),
    );
  });

  it('show the text of an applied filter, and follow it when a chip takes it away', async () => {
    const user = userEvent.setup();
    const router = renderList(`/Book?f=${encodeURIComponent(JSON.stringify([['title', 'like', 'dune']]))}`);
    await waitFor(() => expect(lastRequestedFilters()).toEqual([['title', 'like', 'dune']]));
    const title = within(quickFilters()).getByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('dune');

    await user.click(screen.getByRole('button', { name: 'ui.filter.removeChip' }));

    await waitFor(() => expect(urlFilters(router)).toEqual([]));
    expect(title).toHaveValue('');
  });

  it('filter a Datetime field by the instant of the wall time typed in the zone of the person', async () => {
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    fireEvent.change(within(quickFilters()).getByLabelText('Due at'), { target: { value: '2026-07-02T09:00' } });

    await waitFor(() => expect(urlFilters(router)).toEqual([['due_at', '=', '2026-07-02T07:00:00.000Z']]));
  });

  it('show an applied Datetime filter on the wall clock of the person', async () => {
    const applied = [['due_at', '=', '2026-07-02T07:00:00.000Z']];
    renderList(`/Book?f=${encodeURIComponent(JSON.stringify(applied))}`);
    await waitFor(() => expect(lastRequestedFilters()).toEqual(applied));

    expect(within(quickFilters()).getByLabelText('Due at')).toHaveValue('2026-07-02T09:00');
  });

  it('are not drawn for an entity that flags no field', async () => {
    shown.meta = { ...BOOK, fields: BOOK.fields.map((field) => ({ ...field, in_standard_filter: false })) };
    renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    expect(screen.queryByRole('group', { name: 'ui.filter.title' })).not.toBeInTheDocument();
  });
});
