// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { ListRenderer } from '@/components/render/ListRenderer';
import TableControl from '@/controls/TableControl';
import type { FieldControlState } from '@/controls/types';

afterEach(cleanup);

const noop = () => {};

function meta(fields: Partial<FieldDefinition>[], extra: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: 'Widget',
    label: 'Widget',
    label_plural: 'Widgets',
    title_field: 'name',
    fields,
    permissions: [],
    ...extra,
  } as unknown as EntityDefinition;
}

describe('ListRenderer (generic meta-driven render)', () => {
  it('renders in_list_view columns + row data from metadata', () => {
    const m = meta([
      { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
    ]);
    const rows = [
      { _id: 'c1', name: 'Acme', city: 'Berlin' },
      { _id: 'c2', name: 'Globex', city: 'Munich' },
    ];
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={rows}
        page={1}
        total={2}
        totalPages={1}
        onRowClick={noop}
        onSort={noop}
        onPageChange={noop}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('City'); // a data-column header (label fallback)
    expect(text).toContain('Acme'); // primary cell
    expect(text).toContain('Berlin'); // data cell value
  });

  it('minimal-app invariant: an entity with no in_list_view fields still renders (primary column)', () => {
    const m = meta([{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }]); // no in_list_view
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={[{ _id: 'c1', name: 'Acme' }]}
        page={1}
        total={1}
        totalPages={1}
        onRowClick={noop}
        onSort={noop}
        onPageChange={noop}
      />,
    );
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.textContent ?? '').toContain('Acme');
  });

  it('visibleColumns override controls which data columns appear', () => {
    const m = meta([
      { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
      { fieldname: 'phone', fieldtype: 'Data', label: 'Phone', in_list_view: true },
    ]);
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={[{ _id: 'c1', name: 'Acme', city: 'Berlin', phone: '123' }]}
        visibleColumns={['phone']}
        page={1}
        total={1}
        totalPages={1}
        onRowClick={noop}
        onSort={noop}
        onPageChange={noop}
      />,
    );
    const headers = Array.from(container.querySelectorAll('th')).map((h) => h.textContent ?? '');
    expect(headers.some((h) => h.includes('Phone'))).toBe(true);
    expect(headers.some((h) => h.includes('City'))).toBe(false); // excluded by the override
  });
});

const CELL_STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

describe('TableControl per-row required indicator', () => {
  it("marks a column with mandatory_depends_on (or static required) with an asterisk", () => {
    const field = {
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      child_fields: [
        { fieldname: 'code', fieldtype: 'Data', label: 'Code', mandatory_depends_on: "eval:doc.type=='x'" },
        { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
      ],
    } as unknown as FieldDefinition;
    const { container } = render(
      <Suspense fallback={null}>
        <TableControl
          field={field}
          value={[]}
          doc={{}}
          state={CELL_STATE}
          entity="Widget"
          onChange={noop}
          controlId="lines"
          labelId="lines-label"
        />
      </Suspense>,
    );
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    const acc = headers.find((h) => h.textContent?.includes('Code'));
    const note = headers.find((h) => h.textContent?.includes('Note'));
    expect(acc?.textContent).toContain('*'); // mandatory_depends_on → may be required
    expect(note?.textContent).not.toContain('*'); // plain optional → no marker
  });
});
