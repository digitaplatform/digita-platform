import { ObjectId } from "mongodb";

// A stringified MongoDB ObjectId: exactly 24 hex chars. Legacy/reference ids
// (e.g. "DE", "EUR", "PROD-000001", a dashed UUID) never match this, so the
// codec leaves them untouched — letting native-ObjectId (`system` naming) docs
// and legacy string-`_id` docs coexist. See docs/guides/id-concept.md.
const HEX24 = /^[0-9a-f]{24}$/i;

/**
 * In-memory / JSON form of an `_id` (or any value that may be an ObjectId):
 * always a string. A native ObjectId becomes its 24-hex string; everything else
 * is `String()`-coerced. Keeps `_id` a string for app/engine/UI code.
 */
export function toIdString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof ObjectId) return value.toHexString();
  return String(value);
}

/**
 * Storage / query form of an `_id`: a 24-hex string is a stringified ObjectId
 * (a `system`-named document) → return the native ObjectId so MongoDB stores and
 * matches it as the BSON type. Any other string is returned unchanged.
 */
export function toIdStorage(id: string | ObjectId): string | ObjectId {
  if (id instanceof ObjectId) return id;
  return HEX24.test(id) ? new ObjectId(id) : id;
}

/**
 * Normalize a query value that targets the `_id` field, so a 24-hex string is
 * matched as its native ObjectId. Handles a bare value and the common operator
 * shapes ($in / $nin / $eq / $ne). Mixed arrays keep legacy string ids untouched,
 * so a collection holding both id kinds still matches. Only apply this to the
 * `_id` field — Link values are stored as plain strings and must stay strings.
 */
export function normalizeIdFilterValue(value: unknown): unknown {
  if (typeof value === "string") return toIdStorage(value);
  if (value instanceof ObjectId) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const out: Record<string, unknown> = { ...v };
    for (const op of ["$in", "$nin"] as const) {
      const arr = v[op];
      if (Array.isArray(arr)) out[op] = arr.map((e) => (typeof e === "string" ? toIdStorage(e) : e));
    }
    for (const op of ["$eq", "$ne"] as const) {
      if (typeof v[op] === "string") out[op] = toIdStorage(v[op] as string);
    }
    return out;
  }
  return value;
}
