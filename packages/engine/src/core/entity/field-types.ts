import type { EntityDefinition, FieldType, FieldDefinition } from "@digitaplatform/shared";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";
import { childPasswordFields, encryptPassword, isEncryptedPassword } from "./password-cipher.js";

/**
 * Field-type handlers cover (de)serialization for MongoDB storage. Validation
 * lives in the Zod schema layer (`field-to-zod.ts`) and the domain
 * validators (row-uniqueness, link existence). Don't add
 * `.validate()` back here — the layering is intentional.
 */
export interface FieldTypeHandler {
  /** Serialize value for MongoDB storage. */
  toStorage(value: unknown, field: FieldDefinition): unknown;
  /** Deserialize value from MongoDB. */
  fromStorage(value: unknown, field: FieldDefinition): unknown;
  /** Whether this field type is stored in MongoDB. */
  isStored: boolean;
}

/**
 * Thrown by a field-type handler when a raw input value cannot be serialized
 * for storage (e.g. a malformed JSON string on a JSON field). Carries the
 * offending fieldname + an i18n message key + params so `serializeFields` can
 * rewrap it into a `ValidationFailedError` (→ HTTP 400) instead of letting a
 * raw parse error escape as an unhandled 500.
 */
export class FieldValueError extends Error {
  constructor(
    public field: string,
    public message_key: string,
    public params?: Record<string, string>,
  ) {
    super(message_key);
    this.name = "FieldValueError";
  }
}

/**
 * A value that stands for no value: absent, null, or a string of only whitespace.
 * A required field refuses it.
 */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** A `YYYY-MM-DD` day the calendar has: `Date` rolls 2026-02-30 over to March, so the day must come back. */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** An ISO 8601 moment: a calendar day, or a day, `T`, a time and an optional zone. */
export function isIsoMoment(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  return match !== null && isCalendarDay(match[1]!) && !isNaN(new Date(value).getTime());
}

/** A whole number as text: decimal digits with an optional sign, so no `0x10` and no `1e3`. */
const WHOLE_NUMBER_TEXT = /^[+-]?\d+$/;

// ─── Individual Field Type Handlers ──────────────────────

const dataHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    if (value === null || value === undefined) return null;
    return String(value).trim();
  },
  fromStorage(value) {
    return value;
  },
};

const intHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (isBlank(value)) return null;
    // parseInt would cut "1.9" to 1 and "12abc" to 12 without a word; anything but a whole
    // number is refused instead. A boolean or a list is no number either (Number(true) is 1).
    const num = typeof value === "number" || (typeof value === "string" && WHOLE_NUMBER_TEXT.test(value.trim())) ? Number(value) : NaN;
    if (!Number.isInteger(num)) {
      throw new FieldValueError(field.fieldname, "field_invalid_int", { field: field.label || field.fieldname });
    }
    return num;
  },
  fromStorage(value) {
    return value;
  },
};

const durationHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (isBlank(value)) return null;
    const num = typeof value === "number" || (typeof value === "string" && WHOLE_NUMBER_TEXT.test(value.trim())) ? Number(value) : NaN;
    // Duration is a non-negative INTEGER count of seconds. Fail loud instead of
    // silently truncating (parseInt("1.5") → 1), storing NaN (parseInt("abc")) or
    // reading a boolean or a list as a number (Number(true) is 1, Number([]) is 0).
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
      throw new FieldValueError(field.fieldname, "field_invalid_duration", {
        field: field.label || field.fieldname,
      });
    }
    return num;
  },
  fromStorage(value) {
    return value;
  },
};

const floatHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (isBlank(value)) return null;
    const num = parseFloat(String(value));
    const precision = field.precision ?? 6;
    return parseFloat(num.toFixed(precision));
  },
  fromStorage(value) {
    return value;
  },
};

const checkHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    if (value === null || value === undefined) return false;
    return Boolean(value);
  },
  fromStorage(value) {
    return Boolean(value);
  },
};

const selectHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    return value || null;
  },
  fromStorage(value) {
    return value;
  },
};

const dateHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (isBlank(value)) return null;
    // Canonical storage form is a "YYYY-MM-DD" string (UTC calendar day). Accept a
    // Date object (hooks bypass the HTTP zod layer) → its UTC day. Reject anything
    // that isn't a canonical date string, so a stray non-ISO value fails LOUD at
    // write instead of silently mis-comparing against Date filters later.
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new FieldValueError(field.fieldname, "field_invalid_date", { field: field.label || field.fieldname, value: String(value) });
      }
      return value.toISOString().slice(0, 10);
    }
    const s = String(value);
    if (!isCalendarDay(s)) {
      throw new FieldValueError(field.fieldname, "field_invalid_date", { field: field.label || field.fieldname, value: s });
    }
    return s;
  },
  fromStorage(value) {
    return value;
  },
};

const datetimeHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (isBlank(value)) return null;
    // new Date(5) and new Date(true) are moments of 1970, and new Date("5") one of 2001: only an
    // ISO string or a Date names a moment.
    if (!(value instanceof Date ? !isNaN(value.getTime()) : typeof value === "string" && isIsoMoment(value))) {
      throw new FieldValueError(field.fieldname, "field_invalid_date", {
        field: field.label || field.fieldname,
        value: String(value),
      });
    }
    return new Date(value as string | Date);
  },
  fromStorage(value) {
    if (value instanceof Date) return value.toISOString();
    return value;
  },
};

const timeHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (value === null || value === undefined) return null;
    // A wall-clock text: a list or a number is no time, as a Table cell already answers.
    if (typeof value !== "string") {
      throw new FieldValueError(field.fieldname, "field_invalid_time", { field: field.label || field.fieldname });
    }
    return value.trim();
  },
  fromStorage(value) {
    return value;
  },
};

const textHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    return value || null;
  },
  fromStorage(value) {
    return value;
  },
};

const jsonHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (isBlank(value)) return null;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        throw new FieldValueError(field.fieldname, "field_invalid_json", {
          field: field.label || field.fieldname,
        });
      }
    }
    return value;
  },
  fromStorage(value) {
    return value;
  },
};

// A value that already carries a key id is a stored value coming back, as a
// Table row does on a whole-table save, and stays as it is.
const passwordHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    if (isBlank(value)) return null;
    if (isEncryptedPassword(value)) return value;
    return encryptPassword(String(value));
  },
  fromStorage() {
    return undefined;
  },
};

const tagHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    if (value === null || value === undefined) return [];
    return value;
  },
  fromStorage(value) {
    return value || [];
  },
};

const colorHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    return value || null;
  },
  fromStorage(value) {
    return value;
  },
};

const ratingHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    if (value === null || value === undefined) return 0;
    // Do NOT clamp: serialization must not silently squash out-of-range input
    // into [0,1]. Since serialize runs before Zod, a clamp here masked the
    // `.min(0).max(1)` range check — an out-of-range Rating (e.g. 5) must now
    // fail validation (400) rather than be silently rewritten to 1.
    return Number(value);
  },
  fromStorage(value) {
    return value ?? 0;
  },
};

const geoHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    return value || null;
  },
  fromStorage(value) {
    return value;
  },
};

const linkHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    return value || null;
  },
  fromStorage(value) {
    return value;
  },
};

const tableHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    const rows = (value || []) as unknown[];
    const secrets = childPasswordFields(field);
    if (secrets.length === 0) return rows;
    return rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const stored = { ...(row as Record<string, unknown>) };
      for (const f of secrets) if (f.fieldname in stored) stored[f.fieldname] = passwordHandler.toStorage(stored[f.fieldname], f);
      return stored;
    });
  },
  fromStorage(value) {
    return value || [];
  },
};

const layoutHandler: FieldTypeHandler = {
  isStored: false,
  toStorage() {
    return undefined;
  },
  fromStorage() {
    return undefined;
  },
};

const passthroughHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    return value ?? null;
  },
  fromStorage(value) {
    return value;
  },
};

// ─── Registry ────────────────────────────────────────────

const FIELD_TYPE_MAP: Record<FieldType, FieldTypeHandler> = {
  Data: dataHandler,
  Text: textHandler,
  SmallText: textHandler,
  TextEditor: textHandler,
  Code: textHandler,
  Markdown: textHandler,
  Int: intHandler,
  Float: floatHandler,
  Currency: floatHandler,
  Percent: floatHandler,
  Check: checkHandler,
  Date: dateHandler,
  Datetime: datetimeHandler,
  Time: timeHandler,
  Duration: durationHandler,
  Select: selectHandler,
  Link: linkHandler,
  Table: tableHandler,
  Attach: dataHandler,
  AttachImage: dataHandler,
  Image: dataHandler,
  Password: passwordHandler,
  JSON: jsonHandler,
  Geolocation: geoHandler,
  Signature: passthroughHandler,
  Rating: ratingHandler,
  Barcode: dataHandler,
  Color: colorHandler,
  Tag: tagHandler,
  Phone: dataHandler,
  SectionBreak: layoutHandler,
  ColumnBreak: layoutHandler,
  TabBreak: layoutHandler,
  Heading: layoutHandler,
  HTML: layoutHandler,
};

export function getFieldTypeHandler(fieldtype: FieldType): FieldTypeHandler {
  return FIELD_TYPE_MAP[fieldtype] || passthroughHandler;
}

export function isStoredFieldType(fieldtype: FieldType): boolean {
  return !LAYOUT_FIELD_TYPES.includes(fieldtype);
}

/**
 * The row a reader gets from a stored row: each stored field through its type's
 * `fromStorage`, which is what hides a Password value. Every path that returns a
 * stored row to a caller goes through here. Table rows are not descended into.
 */
/** The hash the seed loader stamps on a row it writes (seed-app-data.ts); a read never shows it. */
export const SEED_HASH_FIELD = "_seed_hash";

export function readStoredRow(
  entity: EntityDefinition,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const { [SEED_HASH_FIELD]: _seedHash, ...read } = row;
  void _seedHash;
  for (const field of entity.fields) {
    const value = row[field.fieldname];
    if (!isStoredFieldType(field.fieldtype) || value === undefined || value === null) continue;
    read[field.fieldname] = getFieldTypeHandler(field.fieldtype).fromStorage(value, field);
  }
  return read;
}
