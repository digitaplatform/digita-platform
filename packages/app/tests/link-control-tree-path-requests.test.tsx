// @vitest-environment jsdom
// The requests a Link field sends for the path of a tree node, run through the real useList against
// a stubbed engine: a field without a tree node to name asks for nothing, the path stops at a parent
// the list does not return or at one it has already met, and no partial path shows while the next
// level loads.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

type ListParams = { filters?: [string, string, unknown][]; page_size?: number };
const engine = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  requests: [] as ListParams[],
  /** A request naming this many ids waits until the test lets it through. */
  holdAt: 0,
  release: () => {},
}));
vi.mock('@/services/resource', () => ({
  // Answers as the engine does: only the rows whose _id an `in` filter names.
  getList: async (_entity: string, params: ListParams) => {
    engine.requests.push(params);
    const ids = params.filters?.find(([field, op]) => field === '_id' && op === 'in')?.[2] as string[];
    if (ids.length === engine.holdAt) await new Promise<void>((resolve) => (engine.release = resolve));
    const rows = engine.rows.filter((r) => ids.includes(r._id as string));
    return { data: rows, meta: { total: rows.length, page: 1, page_size: params.page_size, total_pages: 1 } };
  },
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: (entity: string) => ({
    data:
      entity === 'CustomerGroup'
        ? { name: entity, title_field: 'name', tree: { parent_field: 'parent', label_field: 'name' }, fields: [] }
        : { name: entity, title_field: 'name', fields: [] },
  }),
}));
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import LinkControl from '@/controls/LinkControl';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

/** Renders a Link to `target` as a form does: the node's own title arrives with the document. */
function renderField(target: string, value: string) {
  const title = engine.rows.find((r) => r._id === value)?.name as string | undefined;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LinkControl
        field={{ fieldname: 'group', fieldtype: 'Link', label: 'Group', target } as FieldDefinition}
        value={value}
        doc={{ _link_titles: { group: title } }}
        entity="Customer"
        state={STATE}
        onChange={() => {}}
        controlId="group"
        labelId="group-label"
      />
    </QueryClientProvider>,
  );
}

const readFieldText = () => (screen.getByRole('combobox') as HTMLInputElement).value;
/** Lets every request the field would send go out and come back, one round trip per turn. */
async function settle() {
  for (let turn = 0; turn < 20; turn++) await act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
}
const askedIds = () => engine.requests.map((r) => r.filters?.find(([f]) => f === '_id')?.[2]);

beforeEach(() => {
  engine.rows = [
    { _id: 'G-1', name: 'Business customers', parent: null },
    { _id: 'G-2', name: 'Hotels', parent: 'G-1' },
    { _id: 'G-5', name: 'Spa hotels', parent: 'G-2' },
  ];
  engine.requests.length = 0;
  engine.holdAt = 0;
});

describe('LinkControl path requests', () => {
  it('sends no list request for a Link to an entity without a tree', async () => {
    engine.rows = [{ _id: 'B-1', name: 'Atlas' }];
    renderField('Book', 'B-1');
    await settle();
    expect(engine.requests).toHaveLength(0);
    expect(readFieldText()).toBe('Atlas');
  });

  it('sends no list request for a tree Link that holds no value', async () => {
    renderField('CustomerGroup', '');
    await settle();
    expect(engine.requests).toHaveLength(0);
  });

  it('asks for the path of a tree Link that holds a value', async () => {
    renderField('CustomerGroup', 'G-5');
    await waitFor(() => expect(readFieldText()).toBe('Business customers › Hotels › Spa hotels'));
    expect(askedIds()).toEqual([['G-5'], ['G-5', 'G-2'], ['G-5', 'G-2', 'G-1']]);
  });

  it('shows no partial path while the next level loads', async () => {
    engine.holdAt = 3;
    renderField('CustomerGroup', 'G-5');
    await waitFor(() => expect(engine.requests).toHaveLength(3));
    await settle();
    expect(readFieldText()).toBe('Spa hotels');
    await act(async () => engine.release());
    await waitFor(() => expect(readFieldText()).toBe('Business customers › Hotels › Spa hotels'));
  });

  it('stops after a parent the list does not return and shows the node alone', async () => {
    engine.rows = engine.rows.filter((r) => r._id !== 'G-2');
    renderField('CustomerGroup', 'G-5');
    await settle();
    expect(askedIds()).toEqual([['G-5'], ['G-5', 'G-2']]);
    expect(readFieldText()).toBe('Spa hotels');
  });

  it('ends the path at a parent it has already met', async () => {
    // A path walk that never ends reads these names without end: the read that passes any honest
    // count fails the test instead of hanging it.
    let reads = 0;
    const cycleRow = (_id: string, name: string, parent: string) => ({
      _id,
      parent,
      get name() {
        if (++reads > 1000) throw new Error('the path walk never ends');
        return name;
      },
    });
    engine.rows = [cycleRow('G-7', 'North', 'G-8'), cycleRow('G-8', 'South', 'G-7')];
    renderField('CustomerGroup', 'G-7');
    await waitFor(() => expect(readFieldText()).toBe('South › North'));
    expect(askedIds()).toEqual([['G-7'], ['G-7', 'G-8']]);
  });
});
