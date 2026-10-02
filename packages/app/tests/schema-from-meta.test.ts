import { describe, it, expect } from 'vitest';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { buildZodSchema, fieldErrorTexts } from '@/lib/schema-from-meta';

function field(f: Partial<FieldDefinition> & { fieldname: string }): FieldDefinition {
  return { fieldtype: 'Data', label: f.fieldname, ...f } as FieldDefinition;
}
function entity(fields: FieldDefinition[]): Pick<EntityDefinition, 'fields'> {
  return { fields };
}

describe('buildZodSchema — base types + constraints', () => {
  it('required string rejects empty/undefined; optional passes', () => {
    const schema = buildZodSchema(entity([field({ fieldname: 'name', required: true })]));
    expect(schema.safeParse({ name: 'ok' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);

    const opt = buildZodSchema(entity([field({ fieldname: 'name' })]));
    expect(opt.safeParse({}).success).toBe(true);
  });

  it('Int coerces numeric strings', () => {
    const schema = buildZodSchema(entity([field({ fieldname: 'qty', fieldtype: 'Int', required: true })]));
    const r = schema.safeParse({ qty: '5' });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { qty: number }).qty).toBe(5);
  });

  it('Select with options → enum', () => {
    const schema = buildZodSchema(
      entity([field({ fieldname: 's', fieldtype: 'Select', options: ['a', 'b'], required: true })]),
    );
    expect(schema.safeParse({ s: 'a' }).success).toBe(true);
    expect(schema.safeParse({ s: 'z' }).success).toBe(false);
  });

  it('Email format via Data options', () => {
    const schema = buildZodSchema(
      entity([field({ fieldname: 'e', fieldtype: 'Data', options: 'Email', required: true })]),
    );
    expect(schema.safeParse({ e: 'a@b.co' }).success).toBe(true);
    expect(schema.safeParse({ e: 'nope' }).success).toBe(false);
  });

  it('max_length is enforced', () => {
    const schema = buildZodSchema(entity([field({ fieldname: 'n', max_length: 3 })]));
    expect(schema.safeParse({ n: 'ab' }).success).toBe(true);
    expect(schema.safeParse({ n: 'abcd' }).success).toBe(false);
  });

  it('passthrough keeps engine-internal keys', () => {
    const schema = buildZodSchema(entity([field({ fieldname: 'name' })]));
    const r = schema.safeParse({ name: 'x', _id: 'X-1', docstatus: 0 });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as { _id: string })._id).toBe('X-1');
  });
});

describe('buildZodSchema — conditional required (superRefine)', () => {
  it('fires only when the resolver says required AND the value is empty', () => {
    const fields = [field({ fieldname: 'reason', mandatory_depends_on: 'doc.x' })];
    const requiredNow = buildZodSchema(entity(fields), (fn) => fn === 'reason');
    const notRequired = buildZodSchema(entity(fields), () => false);

    expect(requiredNow.safeParse({ reason: '' }).success).toBe(false);
    expect(requiredNow.safeParse({ reason: 'because' }).success).toBe(true);
    expect(notRequired.safeParse({ reason: '' }).success).toBe(true);
  });

  it('binds the issue to the field path', () => {
    const schema = buildZodSchema(entity([field({ fieldname: 'reason' })]), (fn) => fn === 'reason');
    const r = schema.safeParse({ reason: undefined });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['reason']);
  });
});

describe('buildZodSchema — a field required by the resolver that the engine fills on insert', () => {
  const fields = [field({ fieldname: 'ref', mandatory_depends_on: 'doc.x', default: 'eval:doc.code' })];

  it('refuses whitespace on a new record, which the engine keeps and refuses', () => {
    const schema = buildZodSchema(entity(fields), () => true);
    expect(schema.safeParse({ ref: '   ' }).success).toBe(false);
  });

  it('PLANTED INNOCENT: lets a new record leave it empty, for the engine to fill', () => {
    const schema = buildZodSchema(entity(fields), () => true);
    expect(schema.safeParse({ ref: undefined }).success).toBe(true);
    expect(schema.safeParse({ ref: '' }).success).toBe(true);
  });

  it('refuses it empty on a stored record, which gets no default', () => {
    const schema = buildZodSchema(entity(fields), () => true, { _id: 'R-1', ref: 'old' });
    expect(schema.safeParse({ ref: '' }).success).toBe(false);
  });
});

describe('buildZodSchema — a required Check must be ticked and a required Rating above 0', () => {
  const issues = (schema: ReturnType<typeof buildZodSchema>, doc: Record<string, unknown>) => {
    const r = schema.safeParse(doc);
    return r.success ? [] : r.error.issues.map((i) => [i.path.join('.'), i.message]);
  };
  const fields = [
    field({ fieldname: 'agreed', fieldtype: 'Check', required: true }),
    field({ fieldname: 'score', fieldtype: 'Rating', required: true }),
  ];
  const schema = buildZodSchema(entity(fields), (fn) => fn === 'agreed' || fn === 'score');

  it('refuses an unticked box and a Rating of 0 with field_required', () => {
    expect(issues(schema, { agreed: 0, score: 0 })).toEqual([
      ['agreed', 'field_required'],
      ['score', 'field_required'],
    ]);
    expect(issues(schema, { agreed: false, score: 0 })[0]).toEqual(['agreed', 'field_required']);
  });

  it('accepts a ticked box and a Rating above 0', () => {
    expect(issues(schema, { agreed: 1, score: 0.2 })).toEqual([]);
    expect(issues(schema, { agreed: true, score: 1 })).toEqual([]);
  });

  it('accepts an unticked box and a Rating of 0 when the field is not required now', () => {
    const optional = buildZodSchema(entity(fields.map((f) => ({ ...f, required: false }))), () => false);
    expect(issues(optional, { agreed: 0, score: 0 })).toEqual([]);
  });
});

describe('fieldErrorTexts — the text each field shows for its error', () => {
  // Each parameter a message names is shown, so a test reads what was filled in.
  const t = (key: string, params?: Record<string, string | number>) =>
    [key, params?.field, params?.min, params?.max].filter((v) => v !== undefined).join(': ');
  const fieldName = (fieldname: string, fallback?: string) => fallback ?? fieldname;
  const fields = [
    field({ fieldname: 'code', label: 'Code', min_length: 2, max_length: 3 }),
    field({ fieldname: 'qty', fieldtype: 'Int', label: 'Qty', min_value: 1, max_value: 9 }),
    field({
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      min_rows: 1,
      max_rows: 2,
      // A limit the Table itself does not use, so a cell's limit read from the Table shows.
      max_length: 99,
      child_fields: [field({ fieldname: 'sku', label: 'SKU', max_length: 4 })],
    }),
  ];
  const text = (fieldname: string, message: string) => fieldErrorTexts({ [fieldname]: { message } }, fields, t, fieldName)[fieldname];

  it('PLANTED DEFECT: fills each limit a message names from its field', () => {
    expect(text('code', 'field_min_length')).toBe('field_min_length: Code: 2');
    expect(text('code', 'field_max_length')).toBe('field_max_length: Code: 3');
    expect(text('qty', 'field_min_value')).toBe('field_min_value: Qty: 1');
    expect(text('qty', 'field_max_value')).toBe('field_max_value: Qty: 9');
    expect(text('lines', 'table_min_rows')).toBe('table_min_rows: Lines: 1');
    expect(text('lines', 'table_max_rows')).toBe('table_max_rows: Lines: 2');
    expect(text('code', 'field_required')).toBe('field_required: Code');
  });

  it("PLANTED DEFECT: names a Table cell's error by the cell and fills the cell's own limit", () => {
    const errors = { lines: [undefined, { sku: { message: 'field_max_length' } }] };
    expect(fieldErrorTexts(errors, fields, t, fieldName)).toEqual({ lines: 'field_max_length: Lines: SKU: 4' });
  });
});
