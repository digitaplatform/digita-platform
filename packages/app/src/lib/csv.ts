import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';

/**
 * CSV export for the generic list. Pure builders (testable) + a browser download
 * helper. Columns mirror ListRenderer's resolution (the explicit ordered set when
 * given, else in_list_view) so "Export CSV" matches what the user sees, with the
 * primary key as the first column.
 */

/** RFC 4180: quote a field if it contains a comma, quote, or newline; double quotes. */
function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Join a matrix of cells into CSV text (CRLF rows, per RFC 4180). */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\r\n');
}

/** Flatten one stored field value to a single CSV cell. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value); // arrays + objects (Link snapshots, tables)
  return String(value);
}

function isColumnField(f: FieldDefinition): boolean {
  return (
    !LAYOUT_FIELD_TYPES.includes(f.fieldtype) &&
    f.fieldtype !== 'ReadOnly' &&
    f.fieldtype !== 'Table'
  );
}

/**
 * The exported columns: the explicit (ordered) visible set when provided, else the
 * meta's in_list_view set — always with the primary key first. Unknown names in the
 * override are dropped. (Mirrors ListRenderer.resolveColumns + its primary column.)
 */
export function exportColumns(meta: EntityDefinition, visibleColumns?: string[]): FieldDefinition[] {
  const primaryKey = meta.title_field || '_id';
  const byName = new Map(meta.fields.map((f) => [f.fieldname, f] as const));

  const chosen =
    visibleColumns && visibleColumns.length
      ? visibleColumns
          .map((n) => byName.get(n))
          .filter((f): f is FieldDefinition => !!f && isColumnField(f))
      : meta.fields.filter((f) => f.in_list_view === true && isColumnField(f));

  const rest = chosen.filter((f) => f.fieldname !== primaryKey);
  const pkField =
    byName.get(primaryKey) ??
    ({ fieldname: primaryKey, label: primaryKey === '_id' ? 'ID' : primaryKey, fieldtype: 'Data' } as FieldDefinition);
  return [pkField, ...rest];
}

/**
 * Build CSV text for a result set: a header row (column labels via `labelFor`,
 * so headers localize like the table) + one row per record.
 */
export function buildListCsv(
  meta: EntityDefinition,
  rows: Record<string, unknown>[],
  visibleColumns: string[] | undefined,
  labelFor: (field: FieldDefinition) => string,
): string {
  const cols = exportColumns(meta, visibleColumns);
  const header = cols.map(labelFor);
  const body = rows.map((r) => cols.map((f) => csvCell(r[f.fieldname])));
  return toCsv([header, ...body]);
}

/**
 * Parse CSV text into a header + rows matrix (RFC 4180: quoted fields, doubled
 * quotes, embedded commas/newlines, CRLF or LF, leading BOM stripped). This is
 * DISPLAY-ONLY for the import wizard's column preview — the authoritative parse
 * happens server-side. Returns `header: []` for empty input.
 */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); records.push(row); row = []; };
  while (i < s.length) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { pushField(); i++; continue; }
    if (c === '\r') { if (s[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length > 0) pushRow();
  const header = records.shift() ?? [];
  // Drop a trailing blank line (a single empty field).
  const rows = records.filter((r) => !(r.length === 1 && r[0] === ''));
  return { header, rows };
}

/** Trigger a browser download of CSV text. A UTF-8 BOM keeps Excel happy. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
