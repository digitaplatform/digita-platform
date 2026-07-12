import { randomUUID } from "crypto";

/**
 * Generate a stable, opaque per-row identifier for embedded Table rows.
 *
 * 16 hex chars derived from a UUID — short enough to fit naturally in
 * composite Link values like `"<parent_id>::<row_id>"` while remaining
 * collision-resistant in practice (~64 bits of randomness).
 */
export function generateRowId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Composite Link value used by `target_path` Links — points at a specific
 * row inside a Table field on the target document.
 *
 *   "<parent_id>::<row_id>"
 */
export const SUB_ROW_SEPARATOR = "::";

export function buildSubRowLink(parentId: string, rowId: string): string {
  return `${parentId}${SUB_ROW_SEPARATOR}${rowId}`;
}

export function parseSubRowLink(value: string): { parentId: string; rowId: string } | null {
  const idx = value.indexOf(SUB_ROW_SEPARATOR);
  if (idx <= 0 || idx === value.length - SUB_ROW_SEPARATOR.length) return null;
  return {
    parentId: value.slice(0, idx),
    rowId: value.slice(idx + SUB_ROW_SEPARATOR.length),
  };
}
