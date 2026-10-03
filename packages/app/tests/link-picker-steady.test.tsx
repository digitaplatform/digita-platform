// @vitest-environment jsdom
// A Link picker stands still while it fills. Its dialog stands at the height of the screen from the
// moment it opens; the search dialog keeps the rows of the previous query until the next answer
// lands; the tree picker's rows load while a person moves to the field, so they stand in the dialog
// when it opens. The engine is a fake whose answers land only when a test lets them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

type SearchAnswer = Array<{ _id: string; display: string; fields?: Record<string, unknown> }>;
const engine = vi.hoisted(() => ({
  searches: [] as Array<{ q: string; filters?: Record<string, unknown>; land: (rows: SearchAnswer) => void }>,
  lists: [] as Array<{ pageSize?: number; land: (rows: Array<Record<string, unknown>>) => void }>,
}));
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  searchLinks: (_entity: string, params: { q: string; filters?: Record<string, unknown> }) =>
    new Promise((resolve) =>
      engine.searches.push({ q: params.q, filters: params.filters, land: (rows) => resolve({ data: rows }) }),
    ),
  getList: (_entity: string, params: { page_size?: number }) =>
    new Promise((resolve) =>
      engine.lists.push({
        pageSize: params.page_size,
        land: (rows) =>
          resolve({ data: rows, meta: { total: rows.length, page: 1, page_size: params.page_size, total_pages: 1 } }),
      }),
    ),
}));
const META = vi.hoisted(() => ({
  Customer: {
    name: 'Customer',
    search_fields: ['name'],
    fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
  },
  CustomerGroup: {
    name: 'CustomerGroup',
    title_field: 'name',
    tree: {},
    fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
  },
  ServiceGroup: {
    name: 'ServiceGroup',
    title_field: 'name',
    tree: { kind: true },
    fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
  },
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: (entity?: string) => ({ data: entity ? META[entity as keyof typeof META] : undefined }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import LinkControl from '@/controls/LinkControl';
import { AddViaLinkSearch } from '@/controls/AddViaLinkSearch';
import { useUiStore } from '@/stores/ui';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};
const CUSTOMER_FIELD = {
  fieldname: 'customer',
  fieldtype: 'Link',
  label: 'Customer',
  target: 'Customer',
  search_dialog: true,
  search_columns: ['name'],
} as FieldDefinition;
const GROUP_FIELD = { fieldname: 'group', fieldtype: 'Link', label: 'Customer group', target: 'CustomerGroup' } as FieldDefinition;
const SERVICE_GROUP_FIELD = {
  fieldname: 'group', fieldtype: 'Link', label: 'Group', target: 'ServiceGroup',
  target_filters: { kind: '$doc.kind' },
} as FieldDefinition;
const FIRST_ANSWER: SearchAnswer = [
  { _id: 'C-1', display: 'Alpine Hotel', fields: { name: 'Alpine Hotel' } },
  { _id: 'C-2', display: 'Bergbahn AG', fields: { name: 'Bergbahn AG' } },
];
const ZUG_ANSWER: SearchAnswer = [{ _id: 'C-3', display: 'Zug Pharma', fields: { name: 'Zug Pharma' } }];
const GROUP_ROWS = [
  { _id: 'G-1', label: 'Business customers', parent: null },
  { _id: 'G-2', label: 'Hotels', parent: 'G-1' },
  { _id: 'G-3', label: 'Private customers', parent: null },
];
const SIZE_OF_SCREEN = ['h-dvh', 'sm:h-[90vh]'];

function renderWithEngine(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

function buildField(field: FieldDefinition, doc: Record<string, unknown> = {}, onChange: (value: unknown) => void = () => {}) {
  return (
    <LinkControl
      field={field}
      value={null}
      doc={doc}
      entity="WorkOrder"
      state={STATE}
      onChange={onChange}
      controlId="field"
      labelId="field-label"
    />
  );
}

function renderField(field: FieldDefinition, doc?: Record<string, unknown>, onChange?: (value: unknown) => void) {
  return renderWithEngine(buildField(field, doc, onChange));
}

/** Lands the engine's answer to every search for `q` sent so far. */
async function landSearch(q: string, rows: SearchAnswer) {
  await waitFor(() => expect(engine.searches.some((s) => s.q === q)).toBe(true));
  await act(async () => {
    for (const search of engine.searches.filter((s) => s.q === q)) search.land(rows);
  });
}

/** Lands the engine's answer to every list request sent so far. */
async function landLists(rows: Array<Record<string, unknown>>) {
  await act(async () => {
    for (const list of engine.lists.splice(0)) list.land(rows);
  });
}

beforeEach(() => {
  engine.searches.length = 0;
  engine.lists.length = 0;
  useUiStore.setState({ treePickerExpandedIds: {} });
});

describe('the search dialog of a Link field', () => {
  it('stands at the height of the screen while its first rows load and after they land', async () => {
    const user = userEvent.setup();
    renderField(CUSTOMER_FIELD);
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass(...SIZE_OF_SCREEN);
    await landSearch('', FIRST_ANSWER);
    await within(panel).findByText('Alpine Hotel');
    expect(panel).toHaveClass(...SIZE_OF_SCREEN);
  });

  it('keeps the rows of the previous query on screen while the next one loads', async () => {
    const user = userEvent.setup();
    renderField(CUSTOMER_FIELD);
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    const panel = screen.getByRole('dialog');
    await landSearch('', FIRST_ANSWER);
    await within(panel).findByText('Alpine Hotel');

    await user.type(within(panel).getByRole('searchbox'), 'zug');
    await waitFor(() => expect(engine.searches.some((s) => s.q === 'zug')).toBe(true));
    expect(within(panel).getByText('Alpine Hotel')).toBeInTheDocument();
    expect(within(panel).getByText('Bergbahn AG')).toBeInTheDocument();
    expect(within(panel).getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).queryByText('ui.link.searching')).toBeNull();

    await landSearch('zug', ZUG_ANSWER);
    await within(panel).findByText('Zug Pharma');
    expect(within(panel).queryByText('Alpine Hotel')).toBeNull();
    expect(within(panel).getByRole('table')).not.toHaveAttribute('aria-busy');
  });

  it('lets no row of the previous text be picked from the first keystroke of the next one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderField(CUSTOMER_FIELD, {}, onChange);
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    const panel = screen.getByRole('dialog');
    await landSearch('', FIRST_ANSWER);
    await within(panel).findByText('Alpine Hotel');

    // The search for "zug" goes out only after the debounce; the rows are marked before it does.
    await user.type(within(panel).getByRole('searchbox'), 'zug');
    expect(within(panel).getByRole('table')).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Enter}');
    await user.click(within(panel).getByText('Bergbahn AG'));
    expect(onChange).not.toHaveBeenCalled();

    await landSearch('zug', ZUG_ANSWER);
    await user.click(await within(panel).findByText('Zug Pharma'));
    expect(onChange.mock.calls.map((call) => call[0])).toEqual(['C-3']);
  });

  it('lets no remembered row be picked when it opens with text typed into the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderField(CUSTOMER_FIELD, {}, onChange);
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    await landSearch('', FIRST_ANSWER);
    await within(screen.getByRole('dialog')).findByText('Alpine Hotel');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.type(screen.getByRole('combobox'), 'zug{Enter}');
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByRole('table')).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the rows a search dialog keeps while the next answer loads', () => {
  const COMPANY_FIELD = { ...CUSTOMER_FIELD, target_filters: { company: '$doc.company' } } as FieldDefinition;

  it('are the rows of another text of the same search, under the same filter', async () => {
    const user = userEvent.setup();
    renderField(COMPANY_FIELD, { company: 'A' });
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    const panel = screen.getByRole('dialog');
    await landSearch('', FIRST_ANSWER);
    await within(panel).findByText('Alpine Hotel');

    await user.type(within(panel).getByRole('searchbox'), 'zug');
    await waitFor(() => expect(engine.searches.some((s) => s.q === 'zug')).toBe(true));
    expect(within(panel).getByText('Alpine Hotel')).toBeInTheDocument();
    expect(within(panel).getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('are never the rows of another filter: the dialog for company B shows no customer of company A', async () => {
    const user = userEvent.setup();
    const view = renderField(COMPANY_FIELD, { company: 'A' });
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    await landSearch('', FIRST_ANSWER);
    await within(screen.getByRole('dialog')).findByText('Alpine Hotel');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    view.rerender(buildField(COMPANY_FIELD, { company: 'B' }));
    await user.click(screen.getByRole('button', { name: 'ui.list.search' }));
    const panel = screen.getByRole('dialog');
    await waitFor(() => expect(engine.searches.map((s) => s.filters)).toEqual([{ company: 'A' }, { company: 'B' }]));
    expect(within(panel).queryByText('Alpine Hotel')).toBeNull();
    expect(within(panel).getByText('ui.link.searching')).toBeInTheDocument();

    await landSearch('', ZUG_ANSWER);
    await within(panel).findByText('Zug Pharma');
  });
});

describe('the add-via-link picker of a table', () => {
  it('keeps the rows of the previous query on screen while the next one loads', async () => {
    const user = userEvent.setup();
    renderWithEngine(<AddViaLinkSearch open onClose={() => {}} linkField={CUSTOMER_FIELD} onPick={() => {}} />);
    const panel = screen.getByRole('dialog');
    expect(panel).toHaveClass(...SIZE_OF_SCREEN);
    await landSearch('', FIRST_ANSWER);
    await within(panel).findByText('Alpine Hotel');

    await user.type(within(panel).getByRole('searchbox'), 'zug');
    await waitFor(() => expect(engine.searches.some((s) => s.q === 'zug')).toBe(true));
    expect(within(panel).getByText('Alpine Hotel')).toBeInTheDocument();
    expect(within(panel).getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).queryByText('ui.link.searching')).toBeNull();

    await landSearch('zug', ZUG_ANSWER);
    await within(panel).findByText('Zug Pharma');
    expect(within(panel).getByRole('table')).not.toHaveAttribute('aria-busy');
  });

  it('lets no row of the previous text be picked from the first keystroke of the next one', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithEngine(<AddViaLinkSearch open onClose={() => {}} linkField={CUSTOMER_FIELD} onPick={onPick} />);
    const panel = screen.getByRole('dialog');
    await landSearch('', FIRST_ANSWER);
    await within(panel).findByText('Alpine Hotel');

    await user.type(within(panel).getByRole('searchbox'), 'zug');
    expect(within(panel).getByRole('table')).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Enter}');
    await user.click(within(panel).getByText('Bergbahn AG'));
    expect(onPick).not.toHaveBeenCalled();

    await landSearch('zug', ZUG_ANSWER);
    await user.click(await within(panel).findByText('Zug Pharma'));
    expect(onPick).toHaveBeenCalledWith('C-3', 'Zug Pharma');
  });
});

describe('the tree picker of a Link field', () => {
  it('has its rows when it opens, because they load while a person moves to the field', async () => {
    const user = userEvent.setup();
    renderField(GROUP_FIELD);
    await user.hover(screen.getByRole('combobox'));
    await landLists(GROUP_ROWS);
    await user.click(screen.getByRole('combobox'));
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByRole('treeitem', { name: 'Business customers' })).toBeInTheDocument();
    expect(within(panel).getByRole('treeitem', { name: 'Private customers' })).toBeInTheDocument();
    expect(panel).toHaveClass(...SIZE_OF_SCREEN);
    // The tree takes the height the dialog has left under its search box, with no cap of its own.
    const tree = within(panel).getByRole('tree');
    expect(tree).toHaveClass('min-h-0', 'flex-1');
    expect(tree.className).not.toMatch(/max-h-\[/);
  });

  it('has its rows when it opens from the keyboard, because they load while the field has focus', async () => {
    const user = userEvent.setup();
    renderField(GROUP_FIELD);
    await user.tab();
    expect(screen.getByRole('combobox')).toHaveFocus();
    await waitFor(() => expect(engine.lists).toHaveLength(1));
    await landLists(GROUP_ROWS);
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('dialog')).getByRole('treeitem', { name: 'Business customers' })).toBeInTheDocument();
  });

  it('loads no tree for a form a person only looks at', () => {
    renderField(GROUP_FIELD);
    expect(engine.lists).toHaveLength(0);
  });

  it('offers no node of the previous partition while the nodes of the new one load', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = renderField(SERVICE_GROUP_FIELD, { kind: 'sales' }, onChange);
    await user.hover(screen.getByRole('combobox'));
    await landLists([{ _id: 'G-S1', label: 'Sales key accounts', parent: null, kind: 'sales' }]);

    view.rerender(buildField(SERVICE_GROUP_FIELD, { kind: 'service' }, onChange));
    await waitFor(() => expect(engine.lists).toHaveLength(1));
    await user.click(screen.getByRole('combobox'));
    const panel = screen.getByRole('dialog');
    expect(within(panel).queryByRole('treeitem', { name: 'Sales key accounts' })).toBeNull();
    expect(within(panel).getByText('ui.link.searching')).toBeInTheDocument();

    await landLists([{ _id: 'G-V1', label: 'Service contracts', parent: null, kind: 'service' }]);
    expect(await within(panel).findByRole('treeitem', { name: 'Service contracts' })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
