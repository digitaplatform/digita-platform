import { describe, it, expect } from 'vitest';
import { resolveFetchFromTargets } from '../src/lib/resolve-fetch-from.ts';
import type { EntityDefinition } from '@digitaplatform/shared';

const meta = {
  name: 'Doc', fields: [
    { fieldname: 'owner', fieldtype: 'Link', label: 'Owner', target: 'Owner' },
    { fieldname: 'zone', fieldtype: 'Link', label: 'Zone', target: 'Zone', fetch_from: 'owner.zone', fetch_if_empty: true },
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
  ],
} as unknown as EntityDefinition;

describe('resolveFetchFromTargets', () => {
  it('returns targets whose fetch_from sources the changed field', () => {
    expect(resolveFetchFromTargets(meta, 'owner')).toEqual([{ target: 'zone', sourcePath: 'zone' }]);
  });
  it('returns nothing for an unrelated field', () => {
    expect(resolveFetchFromTargets(meta, 'note')).toEqual([]);
  });
});
