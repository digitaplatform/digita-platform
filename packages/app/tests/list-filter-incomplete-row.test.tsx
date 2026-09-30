// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { ListParams } from '@/services/resource';

/**
 * A filter row without a field is no filter yet: the engine refuses a filter whose field
 * name is empty with 400, and the list would show its error block instead of the rows.
 * Such a row stays in the filter panel, and neither the URL nor a list request carries it.
 * The page runs on the real data router, as the app does, so the URL and the requests are
 * the ones a person's clicks produce.
 */

const getList = vi.hoisted(() => vi.fn<(entity: string, params: ListParams) => Promise<unknown>>());

const META = {
  name: 'Book',
  label: 'Book',
  title_field: 'title',
  fields: [{ fieldname: 'title', fieldtype: 'Data', label: 'Title' }],
  permissions: [],
} as unknown as EntityDefinition;

vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  getList,
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: META, isLoading: false, isError: false }),
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
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] }; locale: undefined }) => unknown) =>
    sel({ user: { roles: ['Librarian'] }, locale: undefined }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tField: (_e: string, _f: string, fb?: string) => fb ?? '',
      tOption: (_e: string, _f: string, v: string) => v,
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

/** Every filter the list requests carried, AND and OR alike. */
function requestedFilters(): [string, string, unknown][] {
  return getList.mock.calls.flatMap(([, params]) => [
    ...(params.filters ?? []),
    ...(params.or_filters ?? []),
  ]);
}

/** The filter tuples the URL holds, AND and OR alike. */
function urlFilters(router: ReturnType<typeof renderList>): unknown[] {
  const sp = new URLSearchParams(router.state.location.search);
  return ['f', 'of'].flatMap((name) => {
    const raw = sp.get(name);
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  });
}

// A click that changes the URL starts a navigation of the data router, and the new URL starts a
// list query: both run after the click returns, so a check that nothing was sent waits for them.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

function filterPanel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'ui.filter.title' });
}

function fieldPicker(): HTMLElement {
  return within(filterPanel()).getByRole('combobox', { name: 'ui.filter.field' });
}

function fieldPickers(): HTMLElement[] {
  return within(filterPanel()).getAllByRole('combobox', { name: 'ui.filter.field' });
}

async function pickField(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  picker: HTMLElement = fieldPicker(),
): Promise<void> {
  await user.click(picker);
  await user.click(await screen.findByRole('option', { name: label }));
}

beforeEach(() => {
  getList.mockReset();
  getList.mockResolvedValue({ data: [], meta: { total: 0, page: 1, page_size: 20, total_pages: 0 } });
});

describe('a filter row without a field', () => {
  it('stays in the panel and reaches neither the URL nor a list request', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book?page=3');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'ui.filter.button' }));
    await user.click(within(filterPanel()).getByRole('button', { name: /ui\.filter\.addCondition/ }));
    await settle();

    expect(fieldPicker()).toHaveTextContent('ui.filter.selectField');
    // No filter changed, so the URL stays as it was, page and all.
    expect(router.state.location.search).toBe('?page=3');
    expect(requestedFilters()).toEqual([]);
    expect(screen.queryByText('ui.list.loadFailed')).not.toBeInTheDocument();
  });

  it('is sent once it has a field, and keeps the focus of the person picking it', async () => {
    const user = userEvent.setup();
    const router = renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'ui.filter.button' }));
    await user.click(within(filterPanel()).getByRole('button', { name: /ui\.filter\.addCondition/ }));
    await pickField(user, 'Title');

    // A complete row with an empty value is a filter the engine takes: it is sent.
    await waitFor(() => expect(requestedFilters()).toContainEqual(['title', 'like', '']));
    expect(urlFilters(router)).toEqual([['title', 'like', '']]);
    expect(requestedFilters().map(([field]) => field)).not.toContain('');
    // The row the person just completed is still the one on screen, not a new one.
    expect(document.activeElement).toBe(fieldPicker());
  });

  it('left by an applied filter whose field is taken away keeps its place and leaves the URL', async () => {
    const user = userEvent.setup();
    const applied = [
      ['title', 'like', 'dune'],
      ['title', 'like', 'sand'],
    ];
    const router = renderList(`/Book?f=${encodeURIComponent(JSON.stringify(applied))}`);
    await waitFor(() => expect(requestedFilters()).toContainEqual(['title', 'like', 'dune']));

    await user.click(screen.getByRole('button', { name: 'ui.filter.button' }));
    await pickField(user, 'ui.filter.selectField', fieldPickers()[0]);
    await settle();

    const [first, second] = fieldPickers();
    expect(first).toHaveTextContent('ui.filter.selectField');
    expect(second).toHaveTextContent('Title');
    expect(document.activeElement).toBe(first);
    expect(urlFilters(router)).toEqual([['title', 'like', 'sand']]);
    expect(requestedFilters().map(([field]) => field)).not.toContain('');
    expect(getList).toHaveBeenLastCalledWith('Book', expect.objectContaining({ filters: [['title', 'like', 'sand']] }));
  });

  it('stays in the panel when a chip outside it removes an applied filter', async () => {
    const user = userEvent.setup();
    const router = renderList(`/Book?f=${encodeURIComponent(JSON.stringify([['title', 'like', 'dune']]))}`);
    await waitFor(() => expect(requestedFilters()).toContainEqual(['title', 'like', 'dune']));

    await user.click(screen.getByRole('button', { name: 'ui.filter.button' }));
    await user.click(within(filterPanel()).getByRole('button', { name: /ui\.filter\.addCondition/ }));
    await user.click(screen.getByRole('button', { name: 'ui.filter.removeChip' }));
    await settle();

    expect(within(filterPanel()).getAllByRole('combobox', { name: 'ui.filter.field' })).toHaveLength(1);
    expect(fieldPicker()).toHaveTextContent('ui.filter.selectField');
    expect(urlFilters(router)).toEqual([]);
    expect(requestedFilters().map(([field]) => field)).not.toContain('');
  });

  it('goes with Clear all in the panel', async () => {
    const user = userEvent.setup();
    renderList('/Book');
    await waitFor(() => expect(getList).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'ui.filter.button' }));
    await user.click(within(filterPanel()).getByRole('button', { name: /ui\.filter\.addCondition/ }));
    await user.click(within(filterPanel()).getByRole('button', { name: 'ui.filter.clearAll' }));
    await settle();

    expect(within(filterPanel()).queryByRole('combobox', { name: 'ui.filter.field' })).not.toBeInTheDocument();
    expect(within(filterPanel()).getByText('ui.filter.noConditions')).toBeInTheDocument();
  });
});
