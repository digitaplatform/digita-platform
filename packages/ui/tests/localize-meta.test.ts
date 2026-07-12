import { describe, it, expect } from 'vitest';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { EntitySummary } from '@/types';
import { localizeMeta, localizeSummary } from '@/lib/localize-meta';

/**
 * The generic meta localizer is the single seam that joins raw engine metadata
 * with the per-locale translation map — covering entity name + plural, field
 * labels, section headings, help-text and action labels by their canonical key,
 * falling back to the raw value. This proves all label kinds (incl. nested
 * child-table fields) resolve through one pass and the input is never mutated.
 */

const t: Record<string, string> = {
  'entity.Widget': 'Gerät',
  'entity_plural.Widget': 'Geräte',
  'field.Widget.code': 'Kennung',
  'field.Widget.sb_main': 'Hauptbereich', // section heading shares the field namespace
  'description.Widget.code': 'Freitext-Notiz',
  'field.Widget.amount': 'Betrag', // child-table field, keyed under the PARENT entity
  'action.Widget.archive': 'Archivieren',
};

const meta = {
  name: 'Widget',
  label: 'Widget',
  label_plural: 'Widgets',
  fields: [
    { fieldname: 'code', fieldtype: 'Data', label: 'Code', description: 'A free-form note' },
    { fieldname: 'sb_main', fieldtype: 'SectionBreak', label: 'Main' },
    { fieldname: 'extra', fieldtype: 'Data', label: 'Extra' }, // no translation → fallback
    {
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      child_fields: [{ fieldname: 'amount', fieldtype: 'Currency', label: 'Amount' }],
    },
  ],
  actions: [{ action: 'archive', label: 'Archive' }],
} as unknown as EntityDefinition;

describe('localizeMeta', () => {
  const out = localizeMeta(meta, t);
  const field = (n: string) => out.fields.find((f) => f.fieldname === n)!;

  it('localizes entity label + plural', () => {
    expect(out.label).toBe('Gerät');
    expect(out.label_plural).toBe('Geräte');
  });

  it('localizes field labels, section headings and help-text', () => {
    expect(field('code').label).toBe('Kennung');
    expect(field('code').description).toBe('Freitext-Notiz');
    expect(field('sb_main').label).toBe('Hauptbereich');
  });

  it('falls back to the raw label when no translation exists', () => {
    expect(field('extra').label).toBe('Extra');
  });

  it('localizes nested child-table fields under the parent namespace', () => {
    expect(field('lines').child_fields![0]!.label).toBe('Betrag');
  });

  it('localizes action labels', () => {
    expect(out.actions![0]!.label).toBe('Archivieren');
  });

  it('does not mutate the input meta', () => {
    expect(meta.label).toBe('Widget');
    expect(meta.fields[0]!.label).toBe('Code');
    expect(meta.fields[0]!.description).toBe('A free-form note');
  });
});

describe('localizeSummary', () => {
  it('localizes singular + plural, falls back to raw', () => {
    const s = localizeSummary(
      { name: 'Widget', label: 'Widget', label_plural: 'Widgets' } as EntitySummary,
      t,
    );
    expect(s.label).toBe('Gerät');
    expect(s.label_plural).toBe('Geräte');
    const u = localizeSummary({ name: 'Gadget', label: 'Gadget' } as EntitySummary, t);
    expect(u.label).toBe('Gadget'); // no entity.Gadget key → raw
  });
});
