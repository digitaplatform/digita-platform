import { describe, it, expect } from 'vitest';
import type { FieldDefinition } from '@digitaplatform/shared';
import { cellHasError } from '@/lib/cell-validation';

const fd = (extra: Partial<FieldDefinition>): FieldDefinition =>
  ({ fieldname: 'x', fieldtype: 'Float', ...extra }) as unknown as FieldDefinition;

describe('cellHasError', () => {
  it('flags a required empty cell', () => {
    expect(cellHasError(fd({}), true, undefined)).toBe(true);
    expect(cellHasError(fd({}), true, '')).toBe(true);
    expect(cellHasError(fd({}), false, undefined)).toBe(false);
  });

  it('enforces non_negative', () => {
    expect(cellHasError(fd({ non_negative: true }), false, -1)).toBe(true);
    expect(cellHasError(fd({ non_negative: true }), false, 0)).toBe(false);
  });

  it('enforces min_value / max_value', () => {
    expect(cellHasError(fd({ min_value: 0, max_value: 100 }), false, 150)).toBe(true);
    expect(cellHasError(fd({ min_value: 0, max_value: 100 }), false, -5)).toBe(true);
    expect(cellHasError(fd({ min_value: 0, max_value: 100 }), false, 50)).toBe(false);
  });

  it('passes a valid non-empty optional cell', () => {
    expect(cellHasError(fd({}), false, 'abc')).toBe(false);
    expect(cellHasError(fd({ non_negative: true }), false, 5)).toBe(false);
  });
});
