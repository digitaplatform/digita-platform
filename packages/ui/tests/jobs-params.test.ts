// @vitest-environment jsdom
// Metadata-driven job param helpers: seed from defaults/existing, coerce on
// submit. Pins the empty-int regression (a cleared "Batch size" field must
// fall back to the declared default, NOT silently snap to min=1).
import { describe, it, expect } from 'vitest';
import type { ActionParamDef } from '@digitaplatform/shared';
import { seedParams, coerceParams } from '@/pages/JobsPage';

const DUNNING: ActionParamDef[] = [
  { name: 'dry_run', label: 'Dry run', type: 'boolean', default: false },
  { name: 'batch', label: 'Batch size', type: 'int', default: 100, min: 1, max: 500 },
];

describe('job param helpers', () => {
  it('seeds from defaults, keeping falsy defaults (false, 0)', () => {
    const seeded = seedParams([
      { name: 'dry_run', label: 'x', type: 'boolean', default: false },
      { name: 'n', label: 'x', type: 'int', default: 0, min: 0 },
      { name: 's', label: 'x', type: 'select', options: ['a', 'b'] },
    ]);
    expect(seeded).toEqual({ dry_run: false, n: 0, s: 'a' });
  });

  it('seeds from an existing job over the default', () => {
    expect(seedParams(DUNNING, { dry_run: true, batch: 250 })).toEqual({ dry_run: true, batch: 250 });
  });

  it('a cleared int field falls back to the default, never to min', () => {
    expect(coerceParams(DUNNING, { dry_run: false, batch: '' })).toEqual({ dry_run: false, batch: 100 });
    expect(coerceParams(DUNNING, { dry_run: false, batch: '   ' })).toEqual({ dry_run: false, batch: 100 });
  });

  it('clamps a valid int to [min,max] and coerces the string input', () => {
    expect(coerceParams(DUNNING, { batch: '900' }).batch).toBe(500);
    expect(coerceParams(DUNNING, { batch: '0' }).batch).toBe(1);
    expect(coerceParams(DUNNING, { batch: '42' }).batch).toBe(42);
  });

  it('coerces booleans and never emits an internal _cursor', () => {
    const out = coerceParams(DUNNING, { dry_run: true, batch: '100' });
    expect(out.dry_run).toBe(true);
    expect('_cursor' in out).toBe(false);
  });
});
