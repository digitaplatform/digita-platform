import { describe, it, expect } from 'vitest';
import { parseFilterTuplesParam } from '@/lib/filter-from-url';

/**
 * `?f` and `?of` feed the list request as they are decoded. The engine refuses a filter
 * without a field name with 400, so a tuple without a field or an operator is dropped here,
 * as a link written before the filter panel held such rows back may still carry one.
 */
describe('parseFilterTuplesParam', () => {
  it('drops a tuple without a field or without an operator', () => {
    const raw = JSON.stringify([
      ['', '', ''],
      ['', '=', 'x'],
      ['title', '', 'x'],
      ['title', 'like', 'dune'],
    ]);
    expect(parseFilterTuplesParam(raw)).toEqual([['title', 'like', 'dune']]);
  });

  it('keeps a complete tuple whose value is empty: the engine takes it', () => {
    const raw = JSON.stringify([
      ['title', 'like', ''],
      ['parent', '=', null],
    ]);
    expect(parseFilterTuplesParam(raw)).toEqual([
      ['title', 'like', ''],
      ['parent', '=', null],
    ]);
  });
});
