// @vitest-environment jsdom
// A Link field to a tree entity names its node by the path from the root, so two groups of the
// same name under different parents tell apart. The field reads that path one list row per level
// up the tree's parent field, never the whole tree.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

type ListParams = { filters?: [string, string, unknown][]; page_size?: number };
const tree = vi.hoisted(() => ({
  rows: [
    { _id: 'G-1', name: 'Business customers', parent: null },
    { _id: 'G-2', name: 'Hotels', parent: 'G-1' },
    { _id: 'G-3', name: 'Private customers', parent: null },
    { _id: 'G-4', name: 'Hotels', parent: 'G-3' },
    { _id: 'G-5', name: 'Spa hotels', parent: 'G-2' },
  ] as Array<Record<string, unknown>>,
  requests: [] as ListParams[],
  failure: null as Error | null,
}));
vi.mock('@/hooks/useList', () => ({
  // Answers as the engine does: only the rows whose _id an `in` filter names.
  useList: (entity: string | undefined, params: ListParams) => {
    if (!entity) return { data: undefined, isLoading: false, error: null };
    tree.requests.push(params);
    if (tree.failure) return { data: undefined, isLoading: false, error: tree.failure };
    const ids = params.filters?.find(([field, op]) => field === '_id' && op === 'in')?.[2] as string[] | undefined;
    return {
      data: { rows: ids ? tree.rows.filter((r) => ids.includes(r._id as string)) : tree.rows },
      isLoading: false,
      error: null,
    };
  },
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({
    data: {
      name: 'CustomerGroup',
      title_field: 'name',
      tree: { parent_field: 'parent', label_field: 'name' },
      fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
    },
  }),
}));
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import LinkControl from '@/controls/LinkControl';

const FIELD = { fieldname: 'group', fieldtype: 'Link', label: 'Group', target: 'CustomerGroup' } as FieldDefinition;
const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

/** Renders the field as a form does: the node's own title arrives with the document. */
function renderField(value: string, readOnly = false) {
  const title = tree.rows.find((r) => r._id === value)?.name as string;
  return render(
    <LinkControl
      field={FIELD}
      value={value}
      doc={{ _link_titles: { group: title } }}
      entity="Customer"
      state={{ ...STATE, readOnly }}
      onChange={() => {}}
      controlId="group"
      labelId="group-label"
    />,
  );
}

const readFieldText = () => (screen.getByRole('combobox') as HTMLInputElement).value;

beforeEach(() => {
  tree.requests.length = 0;
  tree.failure = null;
});

describe('LinkControl path of a tree node', () => {
  it("shows a child node's parent before its own name", () => {
    renderField('G-2');
    expect(readFieldText()).toBe('Business customers › Hotels');
  });

  it('tells apart two groups of the same name under different parents', () => {
    renderField('G-4');
    expect(readFieldText()).toBe('Private customers › Hotels');
  });

  it('shows every ancestor from the root down', () => {
    renderField('G-5');
    expect(readFieldText()).toBe('Business customers › Hotels › Spa hotels');
  });

  it('shows a node without a parent by its name alone', () => {
    renderField('G-1');
    expect(readFieldText()).toBe('Business customers');
  });

  it('shows the path in the read-only view', () => {
    renderField('G-2', true);
    expect(screen.getByText('Business customers › Hotels')).toBeInTheDocument();
  });

  it("keeps the node's own name and names the failure when its path cannot be read", () => {
    tree.failure = new Error('No permission to select CustomerGroup');
    renderField('G-2');
    expect(readFieldText()).toBe('Hotels');
    expect(screen.getByRole('combobox')).toHaveAttribute('title', 'No permission to select CustomerGroup');
  });

  it('reads the path one row per level and never loads the whole tree', () => {
    renderField('G-5');
    expect(readFieldText()).toBe('Business customers › Hotels › Spa hotels');
    for (const params of tree.requests) {
      const ids = params.filters?.find(([field, op]) => field === '_id' && op === 'in')?.[2] as string[] | undefined;
      expect(ids).toBeDefined();
      expect(ids!.length).toBeLessThanOrEqual(3);
      expect(params.page_size).toBe(ids!.length);
    }
  });
});
