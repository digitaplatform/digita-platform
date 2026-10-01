import { describe, it, expect } from 'vitest';
import type { ActionDefinition, EntityDefinition } from '@digitaplatform/shared';
import { localizeAction, localizeMeta } from '@/lib/localize-meta';

/**
 * The dialog an action opens speaks the session language: each of its fields takes its label from
 * `action_field.<Entity>.<action>.<field>`, and a field without a key keeps the label the entity
 * file writes. The key names the action, so a dialog field does not take the text of an entity
 * field that happens to share its name.
 */

const accept = {
  action: 'accept',
  label: 'Accept quote',
  opens_dialog: true,
  dialog_fields: [
    { fieldname: 'accepted_by', fieldtype: 'Data', label: 'Accepted by' },
    { fieldname: 'signature', fieldtype: 'Signature', label: 'Signature' },
    { fieldname: 'note', fieldtype: 'Text', label: 'Note' },
    {
      fieldname: 'parts',
      fieldtype: 'Table',
      label: 'Parts',
      child_fields: [
        { fieldname: 'qty', fieldtype: 'Int', label: 'Quantity' },
        { fieldname: 'reason', fieldtype: 'Data', label: 'Reason' },
      ],
    },
  ],
} as unknown as ActionDefinition;

const meta = {
  name: 'Quote',
  label: 'Quote',
  fields: [],
  actions: [accept, { action: 'archive', label: 'Archive' }],
} as unknown as EntityDefinition;

const t: Record<string, string> = {
  'action.Quote.accept': 'Angebot annehmen',
  'action_field.Quote.accept.accepted_by': 'Angenommen von',
  'action_field.Quote.accept.signature': 'Unterschrift',
  'action_field.Quote.accept.parts': 'Teile',
  'action_field.Quote.accept.parts.qty': 'Menge',
  // An entity field of the same name is another text and stays out of the dialog.
  'field.Quote.note': 'Interne Notiz',
  'field.Quote.accepted_by': 'Akzeptiert von',
};

describe('localizeMeta dialog fields', () => {
  const out = localizeMeta(meta, t);
  const dialog = out.actions![0]!.dialog_fields!;
  const label = (name: string) => dialog.find((f) => f.fieldname === name)!.label;

  it('takes the label of each dialog field from the locale file', () => {
    expect(label('accepted_by')).toBe('Angenommen von');
    expect(label('signature')).toBe('Unterschrift');
    expect(label('parts')).toBe('Teile');
  });

  it('keeps the written label where a dialog field has no key, also where an entity field has one', () => {
    expect(label('note')).toBe('Note');
  });

  it('translates the columns of a table in the dialog by the table and the column', () => {
    const columns = dialog.find((f) => f.fieldname === 'parts')!.child_fields!;
    expect(columns.map((c) => c.label)).toEqual(['Menge', 'Reason']);
  });

  it('keeps everything else of a dialog field', () => {
    expect(dialog.find((f) => f.fieldname === 'signature')).toMatchObject({ fieldtype: 'Signature' });
  });

  it('still translates the action itself and leaves an action without a dialog alone', () => {
    expect(out.actions![0]!.label).toBe('Angebot annehmen');
    expect(out.actions![1]).toEqual({ action: 'archive', label: 'Archive' });
  });

  it('does not mutate the input meta', () => {
    expect(accept.dialog_fields![0]!.label).toBe('Accepted by');
    expect(accept.dialog_fields![3]!.child_fields![0]!.label).toBe('Quantity');
  });
});

describe('localizeAction', () => {
  it('localizes one action as localizeMeta does, for an action the engine reports for a record', () => {
    const one = localizeAction('Quote', accept, t);
    expect(one.label).toBe('Angebot annehmen');
    expect(one.dialog_fields!.map((f) => f.label)).toEqual(['Angenommen von', 'Unterschrift', 'Note', 'Teile']);
  });
});
