import { z, type ZodTypeAny } from 'zod';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES, ROW_ID_FIELD } from '@digitaplatform/shared';
import { isEvalDefault } from '@/lib/default-tokens';

/**
 * Build a Zod schema from an EntityDefinition for react-hook-form validation.
 * The per-type base + constraints are a faithful MIRROR of the engine's
 * `field-to-zod.ts` (no client/server divergence). Conditional-required
 * (mandatory_depends_on) is enforced by a superRefine that calls a live
 * `requiredResolver` (the sweep's `required`), so the schema instance stays
 * stable across renders. Phase-1 Table is read-only → its row schema omits child
 * required/min_rows/max_rows (those land with the Phase-2 editable grid).
 *
 * Controls emit `undefined` for an empty value (not "" or 0), so the emptiness
 * check distinguishes a blank input from a real 0 without inspecting raw input.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isValidColor = (v: unknown): boolean => typeof v === 'string' && HEX.test(v);

function isStored(t: FieldDefinition['fieldtype']): boolean {
  return !LAYOUT_FIELD_TYPES.includes(t) && t !== 'ReadOnly';
}

function dataLike(field: FieldDefinition): ZodTypeAny {
  if (typeof field.options === 'string') {
    switch (field.options) {
      case 'Email':
        return z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'field_invalid_email');
      case 'URL':
        return z.string().url('field_invalid_url');
      case 'Phone':
        return z.string().regex(/^\+?[\d\s\-()]{7,20}$/, 'field_invalid_phone');
      case 'IP':
        return z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$|:/, 'field_invalid_ip');
    }
  }
  return z.string();
}

function baseForType(field: FieldDefinition): ZodTypeAny {
  switch (field.fieldtype) {
    case 'Data':
    case 'Phone':
    case 'Barcode':
    case 'Signature':
    case 'Attach':
    case 'AttachImage':
    case 'Image':
      return dataLike(field);
    case 'Code':
    case 'Markdown':
    case 'Text':
    case 'SmallText':
    case 'TextEditor':
    case 'Password':
      return z.string();
    case 'Color':
      return z.string().refine(isValidColor, 'field_invalid_color');
    case 'Int':
      return z.coerce.number().int();
    case 'Float':
    case 'Currency':
    case 'Percent':
      return z.coerce.number();
    case 'Rating':
      return z.coerce.number().min(0).max(1);
    case 'Check':
      return z.union([z.boolean(), z.literal(0), z.literal(1)]);
    case 'Date':
    case 'Datetime':
    case 'Time':
      return z.union([z.string(), z.date()]).refine(
        (v) => {
          if (v instanceof Date) return !isNaN(v.getTime());
          if (typeof v !== 'string' || !v) return v === '';
          return !isNaN(new Date(v).getTime());
        },
        { message: 'field_invalid_date' },
      );
    case 'Duration':
      return z.union([z.string(), z.coerce.number()]);
    case 'Select':
      if (Array.isArray(field.options) && field.options.length > 0) {
        return z.enum(field.options as [string, ...string[]]);
      }
      return z.string();
    case 'Link':
      return z.string();
    case 'Tag':
      return z.array(z.string());
    case 'JSON':
      return z.any();
    case 'Geolocation':
      return z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
      });
    case 'Table':
      // A Table inside a row: the engine defaults no row of it.
      return tableSchema(field, () => false);
    case 'ReadOnly':
      return z.any();
    default:
      if (import.meta.env.DEV) console.warn(`[schema-from-meta] unknown field type "${field.fieldtype}" → z.any()`);
      return z.any();
  }
}

function isStringSchema(s: ZodTypeAny): boolean {
  return (s as { _def?: { typeName?: string } })._def?.typeName === 'ZodString';
}
function isNumberSchema(s: ZodTypeAny): boolean {
  return (s as { _def?: { typeName?: string } })._def?.typeName === 'ZodNumber';
}

function applyStringConstraints(schema: ZodTypeAny, field: FieldDefinition): ZodTypeAny {
  if (!isStringSchema(schema)) return schema;
  let s = schema as z.ZodString;
  if (field.max_length) s = s.max(field.max_length, 'field_max_length');
  if (field.min_length) s = s.min(field.min_length, 'field_min_length');
  if (field.regex) {
    try {
      s = s.regex(new RegExp(field.regex), field.regex_message ?? 'field_invalid_regex');
    } catch {
      /* bad regex in entity JSON — caught at engine boot; degrade here */
    }
  }
  return s;
}

function applyNumberConstraints(schema: ZodTypeAny, field: FieldDefinition): ZodTypeAny {
  if (!isNumberSchema(schema)) return schema;
  let s = schema as z.ZodNumber;
  if (field.min_value !== undefined) s = s.min(field.min_value, 'field_min_value');
  if (field.max_value !== undefined) s = s.max(field.max_value, 'field_max_value');
  if (field.non_negative) s = s.min(0, 'field_non_negative');
  return s;
}

/** Child-table schema (mirrors the engine): per-row _row_id/idx + each child field
 *  with its full constraints (required + length/range/regex) + min_rows/max_rows.
 *  (Phase 2 enabled child-required/min/max now that the table is editable.)
 *  The engine evaluates a cell's `eval:` default in each row it defaults on save, so a
 *  required cell with one is refused only in a row the engine does not default. */
function tableSchema(
  field: FieldDefinition,
  isDefaultedOnSave: (row: Record<string, unknown>) => boolean,
): ZodTypeAny {
  const childShape: Record<string, ZodTypeAny> = {
    [ROW_ID_FIELD]: z.string().optional(),
    idx: z.number().int().optional(),
  };
  const evalRequired: FieldDefinition[] = [];
  for (const cf of field.child_fields ?? []) {
    if (!isStored(cf.fieldtype)) continue;
    if (cf.required && isEvalDefault(cf.default)) evalRequired.push(cf);
    childShape[cf.fieldname] = buildFieldSchema(evalRequired.includes(cf) ? { ...cf, required: false } : cf);
  }
  const row = z.object(childShape).passthrough().superRefine((r, ctx) => {
    if (isDefaultedOnSave(r)) return;
    for (const cf of evalRequired) {
      if (isEmptyValue(cf, r[cf.fieldname])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [cf.fieldname], message: 'field_required' });
      }
    }
  });
  let arr = z.array(row);
  if (field.min_rows !== undefined) arr = arr.min(field.min_rows, 'table_min_rows');
  if (field.max_rows !== undefined) arr = arr.max(field.max_rows, 'table_max_rows');
  return arr;
}

function buildFieldSchema(field: FieldDefinition): ZodTypeAny {
  let s = baseForType(field);
  s = applyStringConstraints(s, field);
  s = applyNumberConstraints(s, field);
  // Mirrors the engine: the blank check runs before the type rules, so a blank value gets
  // only field_required, also in a Table cell, which no required resolver covers.
  if (field.required) return z.unknown().refine((v) => !isEmptyValue(field, v), 'field_required').pipe(s);
  return s.nullable().optional();
}

/** Mirrors the engine: whitespace, an unticked Check and a Rating of 0 are no value, so a required one refuses them. */
function isEmptyValue(field: FieldDefinition, v: unknown): boolean {
  if (field.fieldtype === 'Check' && (v === false || v === 0)) return true;
  if (field.fieldtype === 'Rating' && Number(v) === 0) return true;
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/**
 * The message a field shows at its control, from the form's error for that field. A Table's
 * errors arrive per row and cell, and the grid draws no message per cell, so the Table shows
 * the first one.
 */
export function fieldErrorMessage(error: unknown): string | undefined {
  const own = (error as { message?: unknown } | undefined)?.message;
  if (typeof own === 'string') return own;
  if (!Array.isArray(error)) return undefined;
  for (const row of error) {
    if (!row || typeof row !== 'object') continue;
    for (const cell of Object.values(row)) {
      const message = (cell as { message?: unknown } | undefined)?.message;
      if (typeof message === 'string') return message;
    }
  }
  return undefined;
}

/**
 * Mirrors the engine: it defaults every row of a record it inserts, and on update each row
 * whose `_row_id` the stored record does not hold.
 */
function rowDefaultedOnSave(
  stored: Record<string, unknown> | undefined,
  table: string,
): (row: Record<string, unknown>) => boolean {
  if (!stored) return () => true;
  const storedRows = stored[table];
  const storedIds = new Set(
    (Array.isArray(storedRows) ? storedRows : []).map((r) => (r as Record<string, unknown> | null)?.[ROW_ID_FIELD]),
  );
  return (row: Record<string, unknown>) => {
    const id = row[ROW_ID_FIELD];
    return !(typeof id === 'string' && id !== '' && storedIds.has(id));
  };
}

/**
 * @param requiredResolver live `(fieldname) => boolean` from the field-state sweep.
 *        Pass via a ref so the returned schema instance is stable.
 * @param stored the record as the engine holds it, or nothing while the form holds a new one.
 */
export function buildZodSchema(
  entity: Pick<EntityDefinition, 'fields'>,
  requiredResolver?: (fieldname: string) => boolean,
  stored?: Record<string, unknown>,
): ZodTypeAny {
  // The engine evaluates an `eval:` default on insert and refuses the field there when the
  // expression yields nothing; the form cannot evaluate it, so it must not refuse the field first.
  const isFilledOnInsert = (f: FieldDefinition) => !stored && isEvalDefault(f.default);
  const shape: Record<string, ZodTypeAny> = {};
  for (const f of entity.fields) {
    if (!isStored(f.fieldtype)) continue;
    if (f.fieldtype === 'Table') {
      shape[f.fieldname] = tableSchema(f, rowDefaultedOnSave(stored, f.fieldname)).nullable().optional();
    } else {
      shape[f.fieldname] = buildFieldSchema(isFilledOnInsert(f) ? { ...f, required: false } : f);
    }
  }
  // passthrough keeps engine-internal keys (_id/docstatus/owner/creation/modified/
  // _link_titles/_status_indicator/_snapshot) instead of stripping them on parse.
  const base = z.object(shape).passthrough();
  if (!requiredResolver) return base;

  return base.superRefine((data, ctx) => {
    for (const f of entity.fields) {
      // A statically required field is refused by its own schema already.
      if (!isStored(f.fieldtype) || f.fieldtype === 'Table' || f.required || isFilledOnInsert(f)) continue;
      if (requiredResolver(f.fieldname) && isEmptyValue(f, (data as Record<string, unknown>)[f.fieldname])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [f.fieldname], message: 'field_required' });
      }
    }
  });
}
