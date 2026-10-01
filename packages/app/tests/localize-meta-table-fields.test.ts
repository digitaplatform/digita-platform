import { describe, it, expect } from 'vitest';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { localizeMeta } from '@/lib/localize-meta';

/**
 * A child field of a Table is keyed by its table first, `field.<Entity>.<table>.<field>` for its
 * label and `description.<Entity>.<table>.<field>` for its help text, so two tables can name a
 * column the same and still read differently. The key without the table stays for the apps that wrote
 * it, and a child without either key keeps the label the entity file writes.
 */

const meta = {
  name: 'Booking',
  label: 'Booking',
  fields: [
    { fieldname: 'description', fieldtype: 'Text', label: 'Description', description: 'What the booking is for' },
    {
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      child_fields: [
        { fieldname: 'unit', fieldtype: 'Data', label: 'Unit', description: 'The unit that is rented' },
        { fieldname: 'description', fieldtype: 'Data', label: 'Line text' },
        { fieldname: 'qty', fieldtype: 'Int', label: 'Quantity', description: 'How many units' },
        { fieldname: 'remark', fieldtype: 'Data', label: 'Remark' },
      ],
    },
    {
      fieldname: 'damage_reports',
      fieldtype: 'Table',
      label: 'Damage reports',
      child_fields: [
        { fieldname: 'unit', fieldtype: 'Data', label: 'Damaged unit', description: 'The unit that was damaged' },
        { fieldname: 'qty', fieldtype: 'Int', label: 'Quantity' },
      ],
    },
  ],
} as unknown as EntityDefinition;

const t: Record<string, string> = {
  'field.Booking.unit': 'Einheit', // the one text both tables shared
  'field.Booking.lines.unit': 'Mieteinheit',
  'field.Booking.damage_reports.unit': 'Beschädigte Einheit',
  'description.Booking.unit': 'Die Einheit',
  'description.Booking.lines.unit': 'Die vermietete Einheit',
  'description.Booking.damage_reports.unit': 'Die beschädigte Einheit',
  'field.Booking.description': 'Beschreibung',
  'description.Booking.description': 'Wofür die Buchung ist',
  'field.Booking.lines.description': 'Positionstext',
  'field.Booking.qty': 'Menge',
  'description.Booking.qty': 'Wie viele Einheiten',
};

describe('localizeMeta child fields of a table', () => {
  const out = localizeMeta(meta, t);
  const columns = (table: string): FieldDefinition[] => out.fields.find((f) => f.fieldname === table)!.child_fields!;
  const column = (table: string, name: string) => columns(table).find((c) => c.fieldname === name)!;

  it('gives two tables their own label for a column of the same name', () => {
    expect(column('lines', 'unit').label).toBe('Mieteinheit');
    expect(column('damage_reports', 'unit').label).toBe('Beschädigte Einheit');
  });

  it('gives two tables their own help text for a column of the same name', () => {
    expect(column('lines', 'unit').description).toBe('Die vermietete Einheit');
    expect(column('damage_reports', 'unit').description).toBe('Die beschädigte Einheit');
  });

  it('keeps a column that is named like a top-level field apart from it', () => {
    expect(column('lines', 'description').label).toBe('Positionstext');
    expect(out.fields.find((f) => f.fieldname === 'description')!.label).toBe('Beschreibung');
    expect(out.fields.find((f) => f.fieldname === 'description')!.description).toBe('Wofür die Buchung ist');
  });

  it('reads the key without the table where a table has none, for the label and the help text', () => {
    expect(column('lines', 'qty').label).toBe('Menge');
    expect(column('damage_reports', 'qty').label).toBe('Menge');
    expect(column('lines', 'qty').description).toBe('Wie viele Einheiten');
  });

  it('keeps the written label and help text of a column without any key', () => {
    expect(column('lines', 'remark').label).toBe('Remark');
    expect(column('lines', 'unit').fieldtype).toBe('Data');
  });

  it('keys a column of a table inside a table by both tables', () => {
    const nested = {
      name: 'Booking',
      label: 'Booking',
      fields: [
        {
          fieldname: 'lines',
          fieldtype: 'Table',
          label: 'Lines',
          child_fields: [
            {
              fieldname: 'parts',
              fieldtype: 'Table',
              label: 'Parts',
              child_fields: [{ fieldname: 'unit', fieldtype: 'Data', label: 'Unit' }],
            },
          ],
        },
      ],
    } as unknown as EntityDefinition;

    const parts = localizeMeta(nested, {
      'field.Booking.lines.parts': 'Teile',
      'field.Booking.lines.parts.unit': 'Teileeinheit',
      'field.Booking.unit': 'Einheit',
    }).fields[0]!.child_fields![0]!;

    expect(parts.label).toBe('Teile');
    expect(parts.child_fields![0]!.label).toBe('Teileeinheit');
  });

  it('does not take the text of a child field for the table that holds it', () => {
    expect(out.fields.find((f) => f.fieldname === 'lines')!.label).toBe('Lines');
  });

  it('does not mutate the input meta', () => {
    expect(meta.fields[1]!.child_fields![0]!.label).toBe('Unit');
    expect(meta.fields[1]!.child_fields![0]!.description).toBe('The unit that is rented');
  });
});
