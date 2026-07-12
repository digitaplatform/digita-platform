import type { EntityDefinition, FieldDefinition, FieldType } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';

/**
 * The single source of truth for the rich FilterBar's operator model. The engine
 * filter-builder whitelist is the outer bound; the bar exposes a sensible
 * per-fieldtype subset (first = default). assertValidTuple FAILS LOUD on an
 * out-of-whitelist operator, because the engine's filter-builder `default:` branch
 * silently coerces an unknown op to equality — the bar must never emit one.
 */

export type FilterOp =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'in'
  | 'not in'
  | 'like'
  | 'not like'
  | 'between'
  | 'is'
  | 'regex';

/** Every operator the bar may emit (subset of the engine whitelist). */
export const FILTER_OPERATORS: ReadonlySet<string> = new Set<FilterOp>([
  '=', '!=', '>', '>=', '<', '<=', 'in', 'not in', 'like', 'not like', 'between', 'is', 'regex',
]);

export type OperatorArity = 'single' | 'range' | 'multi' | 'presence' | 'boolean';

/** How many/what value an operator takes. `is` → presence token; `between` → [lo,hi]. */
export function operatorArity(op: FilterOp): OperatorArity {
  switch (op) {
    case 'between':
      return 'range';
    case 'in':
    case 'not in':
      return 'multi';
    case 'is':
      return 'presence';
    default:
      return 'single';
  }
}

type Group = 'text' | 'color' | 'select' | 'link' | 'tag' | 'numeric' | 'date' | 'check' | 'presence' | 'excluded';

const TEXT: FieldType[] = ['Data', 'Text', 'SmallText', 'TextEditor', 'Code', 'Markdown', 'Phone', 'Barcode', 'Password'];
const NUMERIC: FieldType[] = ['Int', 'Float', 'Currency', 'Percent', 'Rating', 'Duration'];
const DATE: FieldType[] = ['Date', 'Datetime', 'Time'];
const PRESENCE_ONLY: FieldType[] = ['JSON', 'Geolocation', 'Signature', 'Image', 'Attach', 'AttachImage'];

function group(ft: FieldType): Group {
  if (TEXT.includes(ft)) return 'text';
  if (ft === 'Color') return 'color';
  if (ft === 'Select') return 'select';
  if (ft === 'Link') return 'link';
  if (ft === 'Tag') return 'tag';
  if (NUMERIC.includes(ft)) return 'numeric';
  if (DATE.includes(ft)) return 'date';
  if (ft === 'Check') return 'check';
  if (PRESENCE_ONLY.includes(ft)) return 'presence';
  return 'excluded'; // Table + ReadOnly + layout
}

const OPS_BY_GROUP: Record<Group, FilterOp[]> = {
  text: ['like', 'not like', '=', '!=', 'is'],
  color: ['=', '!=', 'is'],
  select: ['=', '!=', 'in', 'not in', 'is'],
  link: ['=', '!=', 'in', 'not in', 'is'],
  tag: ['in', 'not in', 'is'],
  numeric: ['=', '!=', '>', '>=', '<', '<=', 'between', 'is'],
  date: ['=', '!=', '>', '>=', '<', '<=', 'between', 'is'],
  check: ['='],
  presence: ['is'],
  excluded: [],
};

/** The "advanced" operators not shown as a first-class menu item (ReDoS-guarded). */
export const ADVANCED_OPERATORS: ReadonlySet<FilterOp> = new Set<FilterOp>(['regex']);

/** Operators a field of this type may filter by (first = default). [] = not filterable. */
export function operatorsForFieldtype(ft: FieldType): FilterOp[] {
  return OPS_BY_GROUP[group(ft)];
}

export function valueControlGroup(ft: FieldType): Group {
  return group(ft);
}

/** Fields a user can build a filter on (excludes layout / Table / ReadOnly / presence-less). */
export function filterableFields(meta: Pick<EntityDefinition, 'fields'>): FieldDefinition[] {
  return meta.fields.filter(
    (f) => !LAYOUT_FIELD_TYPES.includes(f.fieldtype) && operatorsForFieldtype(f.fieldtype).length > 0,
  );
}

/** Fields flagged in_standard_filter (the quick-filter row). */
export function standardFilterFields(meta: Pick<EntityDefinition, 'fields'>): FieldDefinition[] {
  return meta.fields.filter((f) => f.in_standard_filter === true && operatorsForFieldtype(f.fieldtype).length > 0);
}

/** FAIL LOUD: the bar must never emit an operator outside the whitelist (the engine
 *  would silently coerce it to `=`). */
export function assertValidTuple(t: [string, string, unknown]): void {
  if (!FILTER_OPERATORS.has(t[1])) {
    const msg = `[filter] illegal operator "${t[1]}" for field "${t[0]}" — not in the FilterBar whitelist`;
    if (import.meta.env.DEV) throw new Error(msg);
    else console.error(msg);
  }
}
