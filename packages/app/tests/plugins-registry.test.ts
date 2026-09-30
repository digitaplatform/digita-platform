// The loader's signature path: a signature is pure config, so loadPlugins registers it with the
// theme from the joined source itself, with nothing to fetch.
import { describe, expect, it } from 'vitest';
import { getSignature } from '@digitaplatform/theme';
import { loadPlugins } from '@/plugins/registry';

describe('loadPlugins', () => {
  it('registers a delivered signature from its source with its title and family', async () => {
    await loadPlugins([{ id: 'lineage', title: 'Lineage', type: 'signature', accent: '#654321', family: 'lineage' }]);
    expect(getSignature('lineage')).toMatchObject({ id: 'lineage', name: 'Lineage', accent: '#654321', family: 'lineage' });
  });

  it('registers a delivered signature without a family as one without', async () => {
    await loadPlugins([{ id: 'solo', title: 'Solo', type: 'signature', accent: '#654321' }]);
    expect(getSignature('solo')).toMatchObject({ id: 'solo', name: 'Solo' });
    expect(getSignature('solo').family).toBeUndefined();
  });
});
