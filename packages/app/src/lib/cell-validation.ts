import type { FieldDefinition } from '@digitaplatform/shared';

/**
 * True when `value` violates the field's inline constraints (required / min_value /
 * max_value / non_negative). `required` is the already-resolved per-row requiredness.
 * Server validation stays authoritative on save; this only drives a cosmetic
 * bounce-back (Enter won't advance past an invalid cell) during entry.
 */
export function cellHasError(cf: FieldDefinition, required: boolean, value: unknown): boolean {
  if (required && (value == null || value === '')) return true;
  if (value != null && value !== '') {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n)) {
      if (cf.non_negative && n < 0) return true;
      if (cf.min_value != null && n < cf.min_value) return true;
      if (cf.max_value != null && n > cf.max_value) return true;
    }
  }
  return false;
}
