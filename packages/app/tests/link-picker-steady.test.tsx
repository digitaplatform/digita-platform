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
  searches: [] as Array<{ q: string; land: (rows: SearchAnswer) => void }>,
  lists: [] as Array<{ pageSize?: number; land: (rows: Array<Record<string, unknown>>) => void }>,
}));
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  searchLinks: (_entity: string, params: { q: string }) =>
    new Promise((resolve) => engine.searches.push({ q: params.q, land: (rows) => resolve({ data: rows }) })),
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
    tree: { parent_field: 'parent', label_field: 'name' },
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
const FIRST_ANSWER: SearchAnswer = [
  { _id: 'C-1', display: 'Alpine Hotel', fields: { name: 'Alpine Hotel' } },
  { _id: 'C-2', display: 'Bergbahn AG', fields: { name: 'Bergbahn AG' } },
];
const ZUG_ANSWER: SearchAnswer = [{ _id: 'C-3', display: 'Zug Pharma', fields: { name: 'Zug Pharma' } }];
const GROUP_ROWS = [
  { _id: 'G-1', name: 'Business customers', parent: null },
  { _id: 'G-2', name: 'Hotels', parent: 'G-1' },
  { _id: 'G-3', name: 'Private customers', parent: null },
];
const SIZE_OF_SCREEN = ['h-dvh', 'sm:h-[90vh]'];

function renderWithEngine(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function renderField(field: FieldDefinition) {
  return renderWithEngine(
    <LinkControl
      field={field}
      value={null}
      doc={{}}
      entity="WorkOrder"
      state={STATE}
      onChange={() => {}}
      controlId="field"
      labelId="field-label"
    />,
  );
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

  it('loads no tree for a form a person only looks at', () => {
    renderField(GROUP_FIELD);
    expect(engine.lists).toHaveLength(0);
  });
});
