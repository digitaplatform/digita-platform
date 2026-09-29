// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readCurrentRecord, rememberCurrentRecord } from '@/lib/list-current';

describe('the record last opened from a list', () => {
  it('is remembered per entity for the tab', () => {
    expect(readCurrentRecord('Widget')).toBeUndefined();
    rememberCurrentRecord('Widget', 'W-1');
    expect(readCurrentRecord('Widget')).toBe('W-1');
    expect(readCurrentRecord('Gadget')).toBeUndefined();
    rememberCurrentRecord('Widget', 'W-2');
    expect(readCurrentRecord('Widget')).toBe('W-2');
  });
});
