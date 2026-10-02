// The setup page draws a settings record's own form, reduced to the fields that are still open.
// Each stays under the section it stands in; a section without an open field is left out, and so
// is every tab and column break, because the few fields that remain make one page.
import { describe, it, expect } from 'vitest';
import type { FieldDefinition } from '@digitaplatform/shared';
import { setupFormFields } from '@/lib/setup-fields';

const field = (fieldname: string, fieldtype = 'Data') => ({ fieldname, fieldtype, label: fieldname }) as FieldDefinition;

const FIELDS = [
  field('code'),
  field('sec_company', 'SectionBreak'),
  field('company_name'),
  field('col', 'ColumnBreak'),
  field('street'),
  field('sec_invoicing', 'SectionBreak'),
  field('hourly_rate', 'Currency'),
  field('tab_more', 'TabBreak'),
  field('sec_texts', 'SectionBreak'),
  field('terms', 'TextEditor'),
  field('sec_qr', 'SectionBreak'),
  field('qr_iban'),
];

const names = (fields: FieldDefinition[]) => fields.map((f) => f.fieldname);

describe('the fields of a setup form', () => {
  it('are the open ones, each under its section, without tab and column breaks', () => {
    expect(names(setupFormFields(FIELDS, new Set(['street', 'hourly_rate'])))).toEqual([
      'sec_company',
      'street',
      'sec_invoicing',
      'hourly_rate',
    ]);
  });

  it('keep a field that stands before the first section', () => {
    expect(names(setupFormFields(FIELDS, new Set(['code', 'qr_iban'])))).toEqual(['code', 'sec_qr', 'qr_iban']);
  });

  it('are none where nothing is open', () => {
    expect(setupFormFields(FIELDS, new Set())).toEqual([]);
  });
});
