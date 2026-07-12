import { describe, it, expect } from 'vitest';
import { ROW_ID_FIELD } from '@digitaplatform/shared';
import { mergePreviewRows, RECOMPUTE_OVERRIDES_KEY } from '@/lib/merge-preview-rows';

// Neutral field names: `out_a` = read-only server cell, `deriv_a` = editable
// server-derived cell, `in_a`/`in_b` = editable input cells backfilled only when empty.
const spec = { owned: ['out_a'], derived: ['deriv_a'], fillable: ['in_a', 'in_b'] };

describe('mergePreviewRows', () => {
  it('always takes owned (read-only) cells from the server', () => {
    const current = [{ [ROW_ID_FIELD]: 'a', in_a: 5, out_a: 0 }];
    const server = [{ [ROW_ID_FIELD]: 'a', in_a: 5, out_a: 50 }];
    const merged = mergePreviewRows(current, server, spec);
    expect(merged).not.toBeNull();
    expect(merged![0]!.out_a).toBe(50);
  });

  it('fills an empty editable cell from the server', () => {
    const current = [{ [ROW_ID_FIELD]: 'a', in_a: undefined }];
    const server = [{ [ROW_ID_FIELD]: 'a', in_a: 9.9 }];
    const merged = mergePreviewRows(current, server, spec);
    expect(merged![0]!.in_a).toBe(9.9);
  });

  it('never overwrites a non-empty editable cell (user entry wins)', () => {
    const current = [{ [ROW_ID_FIELD]: 'a', in_a: 7 }];
    const server = [{ [ROW_ID_FIELD]: 'a', in_a: 9.9 }];
    expect(mergePreviewRows(current, server, spec)).toBeNull();
  });

  it('refreshes an editable derived cell when the server value changes (no stale display)', () => {
    // The row still holds its previous derived value; an input changed upstream so the
    // server recomputed a new one. The derived display must follow, even though the
    // cell is editable AND already non-empty (the exact stale-preview defect).
    const current = [{ [ROW_ID_FIELD]: 'a', deriv_a: 10 }];
    const server = [{ [ROW_ID_FIELD]: 'a', deriv_a: 20 }];
    const merged = mergePreviewRows(current, server, spec);
    expect(merged).not.toBeNull();
    expect(merged![0]!.deriv_a).toBe(20);
  });

  it('preserves a user-overridden derived cell against a differing server value', () => {
    // The user typed into the derived cell — marked as an override — so the recomputed
    // server value must NOT clobber it.
    const current = [
      { [ROW_ID_FIELD]: 'a', deriv_a: 99, [RECOMPUTE_OVERRIDES_KEY]: { deriv_a: true } },
    ];
    const server = [{ [ROW_ID_FIELD]: 'a', deriv_a: 20 }];
    expect(mergePreviewRows(current, server, spec)).toBeNull();
  });

  it('still refreshes OTHER derived cells on a row with one overridden cell', () => {
    const twoDerived = { owned: [], derived: ['deriv_a', 'deriv_b'], fillable: [] };
    const current = [
      {
        [ROW_ID_FIELD]: 'a',
        deriv_a: 99,
        deriv_b: 10,
        [RECOMPUTE_OVERRIDES_KEY]: { deriv_a: true },
      },
    ];
    const server = [{ [ROW_ID_FIELD]: 'a', deriv_a: 20, deriv_b: 30 }];
    const merged = mergePreviewRows(current, server, twoDerived)!;
    expect(merged[0]!.deriv_a).toBe(99); // overridden → kept
    expect(merged[0]!.deriv_b).toBe(30); // not overridden → refreshed
  });

  it('matches by _row_id, not index (server rows reordered)', () => {
    const current = [
      { [ROW_ID_FIELD]: 'a', out_a: 0 },
      { [ROW_ID_FIELD]: 'b', out_a: 0 },
    ];
    const server = [
      { [ROW_ID_FIELD]: 'b', out_a: 20 },
      { [ROW_ID_FIELD]: 'a', out_a: 10 },
    ];
    const merged = mergePreviewRows(current, server, spec)!;
    expect(merged[0]!.out_a).toBe(10); // row 'a'
    expect(merged[1]!.out_a).toBe(20); // row 'b'
  });

  it('leaves a row absent from the server response untouched', () => {
    const current = [{ [ROW_ID_FIELD]: 'a', out_a: 3 }];
    const server: Record<string, unknown>[] = [];
    expect(mergePreviewRows(current, server, spec)).toBeNull();
  });

  it('returns null when nothing changed', () => {
    const current = [{ [ROW_ID_FIELD]: 'a', in_a: 5, deriv_a: 20, out_a: 50 }];
    const server = [{ [ROW_ID_FIELD]: 'a', in_a: 5, deriv_a: 20, out_a: 50 }];
    expect(mergePreviewRows(current, server, spec)).toBeNull();
  });
});
