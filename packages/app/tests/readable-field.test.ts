import { describe, it, expect } from 'vitest';
import type { EntityDefinition, EntityPermission, FieldDefinition } from '@digitaplatform/shared';
import { readableFieldPredicate, readableChildFields } from '@/lib/permissions';
import type { SessionUser } from '@/types';

/**
 * readableFieldPredicate answers which fields a read of the engine answers
 * (PermissionChecker.getReadableFields): a read row of one of the user's roles opens the fields
 * of its level, or only those its `fields` names, where its gates admit the record.
 */

const ann: SessionUser = { _id: 'u-ann', email: 'ann@example.com', roles: ['Clerk'] };

function part(permissions: EntityPermission[]): EntityDefinition {
  return { name: 'Part', fields: [], permissions } as unknown as EntityDefinition;
}

describe('readableFieldPredicate', () => {
  it('opens the levels of the read rows of the user roles', () => {
    const canRead = readableFieldPredicate(part([{ role: 'Clerk', level: 0, read: 1 }]), ann, { owner: 'ann@example.com' });
    expect(canRead('name', 0)).toBe(true);
    expect(canRead('purchase_price', 1)).toBe(false);
  });

  it('opens only the fields a read row names', () => {
    const canRead = readableFieldPredicate(part([{ role: 'Clerk', level: 0, read: 1, fields: ['name'] }]), ann);
    expect(canRead('name', 0)).toBe(true);
    expect(canRead('note', 0)).toBe(false);
  });

  it('opens a level only on a record the gates of its read row admit', () => {
    const meta = part([
      { role: 'Clerk', level: 0, read: 1 },
      { role: 'Clerk', level: 1, read: 1, if_owner: true },
    ]);
    expect(readableFieldPredicate(meta, ann, { owner: 'ann@example.com' })('purchase_price', 1)).toBe(true);
    expect(readableFieldPredicate(meta, ann, { owner: 'bob@example.com' })('purchase_price', 1)).toBe(false);
  });

  it('shows level 0 of a record no row lets the user read, which a share admitted', () => {
    const canRead = readableFieldPredicate(part([{ role: 'Clerk', level: 0, select: 1 }]), ann, { owner: 'bob@example.com' });
    expect(canRead('name', 0)).toBe(true);
    expect(canRead('purchase_price', 1)).toBe(false);
  });

  it('hides nothing when the meta carries no rows to judge by', () => {
    expect(readableFieldPredicate(part([]), ann, {})('purchase_price', 1)).toBe(true);
  });

  it('lets Administrator read every field', () => {
    const admin: SessionUser = { _id: 'a1', email: 'admin@example.com', roles: ['Administrator'] };
    expect(readableFieldPredicate(part([{ role: 'Clerk', level: 0, read: 1 }]), admin, {})('purchase_price', 1)).toBe(true);
  });
});

describe('readableChildFields', () => {
  const table = (children: Partial<FieldDefinition>[]) =>
    ({ fieldname: 'lines', fieldtype: 'Table', label: 'Lines', child_fields: children }) as unknown as FieldDefinition;

  it('keeps the children whose level the user reads on the Table', () => {
    const canRead = readableFieldPredicate(part([{ role: 'Clerk', level: 0, read: 1 }]), ann, {});
    const children = readableChildFields(
      table([
        { fieldname: 'item', fieldtype: 'Data', perm_level: 0 },
        { fieldname: 'cost', fieldtype: 'Currency', perm_level: 1 },
      ]),
      canRead,
    );
    expect(children.map((c) => c.fieldname)).toEqual(['item']);
  });

  it('keeps every child of a Table whose children all sit at level 0', () => {
    const canRead = readableFieldPredicate(part([{ role: 'Clerk', level: 1, read: 1 }]), ann);
    const children = readableChildFields(table([{ fieldname: 'item', fieldtype: 'Data' }]), canRead);
    expect(children.map((c) => c.fieldname)).toEqual(['item']);
  });
});
