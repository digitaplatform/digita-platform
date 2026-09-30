import { describe, expect, it } from 'vitest';
import { registerSignature } from '@digitaplatform/theme';
import { resolveOptionSource } from '@/lib/option-sources';

describe('resolveOptionSource', () => {
  it('the signatures source lists every registered signature by name, and stores its id', () => {
    registerSignature({ id: 'veloluck-workbench', name: 'Veloluck Workbench', accent: '#B8541E' });
    registerSignature({ id: 'veloluck-lakeside', name: 'Veloluck Lakeside', accent: '#1F7A5C' });
    expect(resolveOptionSource('signatures')).toEqual([
      { value: 'veloluck-workbench', label: 'Veloluck Workbench' },
      { value: 'veloluck-lakeside', label: 'Veloluck Lakeside' },
    ]);
  });
});
