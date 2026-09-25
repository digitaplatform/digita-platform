import { describe, it, expect } from 'vitest';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { toCsv, csvCell, exportColumns, buildListCsv, parseCsv } from '@/lib/csv';

function meta(fields: Partial<FieldDefinition>[], extra: Partial<EntityDefinition> = {}): EntityDefinition {
  return { name: 'Widget', fields, permissions: [], ...extra } as unknown as EntityDefinition;
}

describe('toCsv', () => {
  it('joins cells with comma and rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe('a,b\r\n1,2');
  });
  it('quotes cells containing comma / quote / newline and doubles quotes', () => {
    expect(toCsv([['a,b', 'c"d', 'e\nf']])).toBe('"a,b","c""d","e\nf"');
  });
});

describe('csvCell', () => {
  it('flattens primitives, null/undefined, and objects', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('x')).toBe('x');
    expect(csvCell(0)).toBe('0'); // not blank — a real zero
    expect(csvCell(false)).toBe('false');
    expect(csvCell(['a', 'b'])).toBe('["a","b"]');
    expect(csvCell({ k: 1 })).toBe('{"k":1}');
  });
});

describe('exportColumns', () => {
  const m = meta(
    [
      { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
      { fieldname: 'notes', fieldtype: 'Text', label: 'Notes' }, // not in_list_view
      { fieldname: '_sb', fieldtype: 'SectionBreak', label: 'x' }, // layout
    ],
    { title_field: 'name' },
  );

  it('defaults to in_list_view with the primary key first', () => {
    const cols = exportColumns(m).map((f) => f.fieldname);
    expect(cols[0]).toBe('name');
    expect(cols).toContain('city');
    expect(cols).not.toContain('notes');
    expect(cols).not.toContain('_sb');
  });

  it('honors an ordered override, primary first, dropping layout/unknown', () => {
    const cols = exportColumns(m, ['city', 'notes', '_sb', 'bogus']).map((f) => f.fieldname);
    expect(cols).toEqual(['name', 'city', 'notes']);
  });
});

describe('buildListCsv', () => {
  const m = meta(
    [
      { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
    ],
    { title_field: 'name' },
  );

  it('builds a header (labels) + one row per record, quoting as needed', () => {
    const rows = [{ _id: 'c1', name: 'Acme, Inc', city: 'Berlin' }];
    const csv = buildListCsv(m, rows, undefined, (f) => f.label ?? f.fieldname);
    expect(csv).toBe('Name,City\r\n"Acme, Inc",Berlin');
  });
});

describe('parseCsv', () => {
  it('parses a header + rows', () => {
    const { header, rows } = parseCsv('a,b,c\r\n1,2,3\r\n4,5,6');
    expect(header).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
  });
  it('handles quoted fields with commas, doubled quotes, and embedded newlines', () => {
    const { header, rows } = parseCsv('name,note\r\n"Acme, Inc","he said ""hi""\nline2"');
    expect(header).toEqual(['name', 'note']);
    expect(rows).toEqual([['Acme, Inc', 'he said "hi"\nline2']]);
  });
  it('strips a leading BOM and tolerates a trailing newline', () => {
    const { header, rows } = parseCsv('﻿a,b\n1,2\n');
    expect(header).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2']]);
  });
  it('returns an empty header for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });
});
