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
  toStorage(value) {
    if (value === null || value === undefined || value === "") return null;
    return parseInt(String(value), 10);
  },
  fromStorage(value) {
    return value;
  },
};

const durationHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value, field) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    // Duration is a non-negative INTEGER count of seconds. Fail loud instead of
    // silently truncating (parseInt("1.5") → 1) or storing NaN (parseInt("abc")).
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
    if (value === null || value === undefined || value === "") return null;
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
    if (value === null || value === undefined || value === "") return null;
    // Canonical storage form is a "YYYY-MM-DD" string (UTC calendar day). Accept a
    // Date object (hooks bypass the HTTP zod layer) → its UTC day. Reject anything
    // that isn't a canonical date string, so a stray non-ISO value fails LOUD at
    // write instead of silently mis-comparing against Date filters later.
    if (value instanceof Date) {
      if (isNaN(value.getTime())) {
        throw new FieldValueError(field.fieldname, "field_invalid_date", { value: String(value) });
      }
      return value.toISOString().slice(0, 10);
    }
    const s = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s).getTime())) {
      throw new FieldValueError(field.fieldname, "field_invalid_date", { value: s });
    }
    return s;
  },
  fromStorage(value) {
    return value;
  },
};

const datetimeHandler: FieldTypeHandler = {
  isStored: true,
  toStorage(value) {
    if (value === null || value === undefined || value === "") return null;
    return new Date(value as string);
  },
  fromStorage(value) {
    if (value instanceof Date) return value.toISOString();
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
    if (value === null || value === undefined) return null;
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
    if (value === null || value === undefined || value === "") return null;
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
  Time: dataHandler,
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
  ReadOnly: passthroughHandler,
  SectionBreak: layoutHandler,
  ColumnBreak: layoutHandler,
  TabBreak: layoutHandler,
  Heading: layoutHandler,
  HTML: layoutHandler,
  Button: layoutHandler,
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
export function readStoredRow(
  entity: EntityDefinition,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const read = { ...row };
  for (const field of entity.fields) {
    const value = row[field.fieldname];
    if (!isStoredFieldType(field.fieldtype) || value === undefined || value === null) continue;
    read[field.fieldname] = getFieldTypeHandler(field.fieldtype).fromStorage(value, field);
  }
  return read;
}
