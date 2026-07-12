import type { BaseDocument } from "./base-document.js";

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

/**
 * Calculate field-level changes between original and current document state.
 */
export function calculateChanges(doc: BaseDocument): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of doc.getChangedFields()) {
    const oldValue = doc._original[field];
    const newValue = doc._data[field];

    // Deep compare for arrays/objects
    if (!deepEqual(oldValue, newValue)) {
      changes.push({
        field,
        old: oldValue ?? null,
        new: newValue ?? null,
      });
    }
  }

  return changes;
}

/**
 * Structural equality for document field values (Date-aware, prototype-blind).
 * Exported for the post-submit computed refresh in DocumentService, which must
 * judge "did this computed hook EFFECTIVELY change the field?" with the same
 * semantics version diffing uses.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;

  if (typeof a !== typeof b) return false;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }

  return false;
}
