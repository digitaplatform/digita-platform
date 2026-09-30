/**
 * A stored row as a MongoDB inclusion projection of `fields` returns it: `_id`, and each named
 * field that the row has. A dotted name reaches into a sub-document, and into every sub-document
 * of an array, arrays inside arrays included, whose other elements it drops. With no fields, the
 * row is returned as it is. `fields` has passed assertListFields, so no path lies inside another.
 * `getList` projects in memory whenever a row gate has to see the whole stored row first.
 */
export function projectFields(
  row: Record<string, unknown>,
  fields: readonly string[] | undefined,
): Record<string, unknown> {
  if (!fields || fields.length === 0) return row;
  const projected: Record<string, unknown> = {};
  setOwn(projected, "_id", row["_id"]);
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
    setOwn(target, key, value);
    return;
  }
  const reached = reach(value, Object.hasOwn(target, key) ? target[key] : undefined, rest);
  if (reached !== undefined) setOwn(target, key, reached);
}

// What the rest of a dotted path reaches in `value`, merged into what an earlier path of the
// same list reached there. A leaf value has nothing inside it, so the path reaches nothing.
function reach(value: unknown, earlier: unknown, rest: readonly string[]): unknown {
  if (Array.isArray(value)) {
    const merged = Array.isArray(earlier) ? earlier : [];
    const reached: unknown[] = [];
    for (const element of value) {
      if (!Array.isArray(element) && !isSubDocument(element)) continue;
      reached.push(reach(element, merged[reached.length], rest));
    }
    return reached;
  }
  if (isSubDocument(value)) {
    const into: Record<string, unknown> = isSubDocument(earlier) ? { ...earlier } : {};
    copyPath(value, into, rest);
    return into;
  }
  return undefined;
}

// A stored key named `__proto__` must land as an own field, not through the prototype setter.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// The driver hands a sub-document back as a plain object; a Date, an ObjectId or any other
// BSON value is an instance of its own class, and a projection treats it as a leaf.
export function isSubDocument(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
