// @vitest-environment jsdom
// The tree picker of a tree with kinds loads only the tree of the form's kind, so the parent of a
// shelf node is picked among shelves, and the engine's TREE_PARTITION is never the first to say no.
// The list mock answers like the engine: only the rows that every filter of the request matches.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

const NODES = [
  { _id: 'shelf-ground', label: 'Ground floor', parent: null, kind: 'shelf' },
  { _id: 'shelf-fiction', label: 'Fiction wall', parent: 'shelf-ground', kind: 'shelf' },
  { _id: 'audience-children', label: 'Children', parent: null, kind: 'audience' },
];
const requests = vi.hoisted(() => ({ filters: [] as Array<Array<[string, string, unknown]>> }));
vi.mock('@/hooks/useList', () => ({
  useList: (entity: string | undefined, options: { filters?: Array<[string, string, unknown]> }) => {
    if (!entity) return { data: undefined, isLoading: false };
    const filters = options.filters ?? [];
    requests.filters.push(filters);
    return { data: { rows: NODES.filter((n) => filters.every(([f, , v]) => (n as Record<string, unknown>)[f] === v)) }, isLoading: false };
  },
}));
vi.mock('@/hooks/useSearchLink', () => ({ useSearchLink: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: { name: 'Category', tree: { kind: true }, fields: [{ fieldname: 'label', fieldtype: 'Data', label: 'Label' }] } }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

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

const parentField = (extra: Partial<FieldDefinition> = {}) =>
  ({ fieldname: 'parent', fieldtype: 'Link', label: 'Parent', target: 'Category', ...extra }) as FieldDefinition;

async function openPicker(field: FieldDefinition) {
  render(
    <LinkControl
      field={field}
      value={null}
      doc={{ kind: 'shelf' }}
      row={undefined}
      parentDoc={undefined}
      entity="Category"
      state={STATE}
      onChange={() => {}}
      controlId="lnk"
      labelId="lnk-label"
    />,
  );
  await userEvent.setup().click(screen.getByRole('combobox'));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  requests.filters = [];
});

describe('the tree picker of a tree with kinds', () => {
  it('PLANTED DEFECT: offers only the nodes of the kind the form holds', async () => {
    const dialog = await openPicker(parentField());
    expect(requests.filters.at(-1)).toEqual([['kind', '=', 'shelf']]);
    expect(within(dialog).getByRole('treeitem', { name: 'Ground floor' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('treeitem', { name: 'Children' })).not.toBeInTheDocument();
  });

  it('PLANTED INNOCENT: lets a target_filters that names kind pick the kind', async () => {
    const dialog = await openPicker(parentField({ target_filters: { kind: 'audience' } }));
    expect(requests.filters.at(-1)).toEqual([['kind', '=', 'audience']]);
    expect(within(dialog).getByRole('treeitem', { name: 'Children' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('treeitem', { name: 'Ground floor' })).not.toBeInTheDocument();
  });
});
