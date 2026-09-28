/**
 * A stored row as a MongoDB inclusion projection of `fields` returns it: `_id`, and each named
 * field that the row has. A dotted name reaches into a sub-document, and into every sub-document
 * of an array, whose other elements it drops. With no fields, the row is returned as it is.
 * `getList` projects in memory whenever a row gate has to see the whole stored row first.
 */
export function projectFields(
  row: Record<string, unknown>,
  fields: readonly string[] | undefined,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return row;
  const projected: Record<string, unknown> = { _id: row["_id"] };
  for (const field of fields) copyPath(row, projected, field.split("."));
  return projected;
}

function copyPath(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  path: readonly string[],
): void {
  const [key, ...rest] = path;
  if (key === undefined || !Object.hasOwn(source, key)) return;
  const value = source[key];
  if (rest.length === 0) {
    target[key] = value;
    return;
  }
  if (Array.isArray(value)) {
    const reached = Array.isArray(target[key]) ? (target[key] as Record<string, unknown>[]) : [];
    target[key] = value.filter(isSubDocument).map((element, index) => {
      const into = { ...(reached[index] ?? {}) };
      copyPath(element, into, rest);
      return into;
    });
  } else if (isSubDocument(value)) {
    const into = isSubDocument(target[key]) ? { ...target[key] } : {};
    copyPath(value, into, rest);
    target[key] = into;
  }
}

// The driver hands a sub-document back as a plain object; a Date, an ObjectId or any other
// BSON value is an instance of its own class, and a projection treats it as a leaf.
function isSubDocument(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
