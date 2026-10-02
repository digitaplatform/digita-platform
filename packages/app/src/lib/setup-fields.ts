import { LAYOUT_FIELD_TYPES, type FieldDefinition } from '@digitaplatform/shared';

/**
 * The fields of a setup form: of a settings record's `fields`, the `open` ones, each under the
 * section it stands in. A section without an open field is left out, and so is every other
 * layout field: the few fields that remain make one page, whatever tabs and columns the full
 * form has.
 */
export function setupFormFields(fields: FieldDefinition[], open: ReadonlySet<string>): FieldDefinition[] {
  const kept: FieldDefinition[] = [];
  let section: FieldDefinition | undefined;
  for (const field of fields) {
    if (field.fieldtype === 'SectionBreak') section = field;
    if (LAYOUT_FIELD_TYPES.includes(field.fieldtype) || !open.has(field.fieldname)) continue;
    if (section) kept.push(section);
    section = undefined;
    kept.push(field);
  }
  return kept;
}
