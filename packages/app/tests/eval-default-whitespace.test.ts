import { describe, it, expect } from 'vitest';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { buildZodSchema } from '@/lib/schema-from-meta';

/**
 * The engine applies an `eval:` default only to a field that holds nothing, null or an
 * empty string. A whitespace-only value counts as a value there, so the engine skips the
 * default and then refuses the required field. The form must refuse it inline instead.
 */
const note: FieldDefinition = {
  fieldname: 'note',
  fieldtype: 'Data',
  label: 'Note',
  required: true,
  default: 'eval:doc.code',
} as FieldDefinition;

const lines: FieldDefinition = {
  fieldname: 'lines',
  fieldtype: 'Table',
  label: 'Lines',
  child_fields: [note],
} as FieldDefinition;

const entity: Pick<EntityDefinition, 'fields'> = { fields: [note, lines] };

function issuePaths(data: Record<string, unknown>): string[] {
  const r = buildZodSchema(entity).safeParse(data);
  if (r.success) return [];
  return r.error.issues.filter((i) => i.message === 'field_required').map((i) => i.path.join('.'));
}

describe('a required field with an eval: default on insert', () => {
  it('refuses a whitespace-only value inline', () => {
    expect(issuePaths({ note: '   ' })).toEqual(['note']);
  });

  it('leaves an empty value to the engine for its default', () => {
    expect(issuePaths({ note: '' })).toEqual([]);
    expect(issuePaths({})).toEqual([]);
  });
});

describe('a required Table cell with an eval: default in a row the engine defaults', () => {
  it('refuses a whitespace-only value inline', () => {
    expect(issuePaths({ note: 'x', lines: [{ note: ' \t ' }] })).toEqual(['lines.0.note']);
  });

  it('leaves an empty value to the engine for its default', () => {
    expect(issuePaths({ note: 'x', lines: [{ note: '' }, {}] })).toEqual([]);
  });
});
