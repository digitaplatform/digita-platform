import { describe, it, expect } from 'vitest';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { buildZodSchema } from '@/lib/schema-from-meta';

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
