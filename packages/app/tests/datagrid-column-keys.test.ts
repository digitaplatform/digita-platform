import { describe, it, expectTypeOf } from 'vitest';
import type { DataGridColumn } from '@digitaplatform/components';

/**
 * A column key the grid never reads promises what nobody gets: a developer who set `writes`
 * and `trigger` expected the grid to drive a server recompute, and it never did. The column
 * offers only keys the grid acts on, and the type check holds it to that.
 */
describe('DataGridColumn', () => {
  it('offers no recompute keys, because the grid drives no recompute', () => {
    expectTypeOf<DataGridColumn>().not.toHaveProperty('writes');
    expectTypeOf<DataGridColumn>().not.toHaveProperty('trigger');
  });
});
