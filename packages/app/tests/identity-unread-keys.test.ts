import { describe, it, expectTypeOf } from 'vitest';
import type { DeliveredSignature, Design, Signature } from '@digitaplatform/theme';
import type { PluginInventoryEntry, PluginSource, SignaturePlugin } from '@digitaplatform/plugins';

/**
 * A key the host never reads promises a designer what nobody gets: a design's density changed no
 * spacing, because the density triples follow the density a person or tenant picks, never the
 * design, and a signature plugin's logoUrl showed no logo, because the chrome draws the tenant's
 * logo, the monogram or the wordmark. No type offers the key, neither the signature a package
 * declares nor the inventory entry, the plugin source and the delivered signature that carry it
 * to the host, and the type check holds a plugin to that.
 */
describe('a design and a signature plugin', () => {
  it('offer no key the host never reads', () => {
    expectTypeOf<Design>().not.toHaveProperty('density');
    expectTypeOf<SignaturePlugin>().not.toHaveProperty('logoUrl');
    expectTypeOf<Signature>().not.toHaveProperty('logoUrl');
    expectTypeOf<PluginInventoryEntry>().not.toHaveProperty('logoUrl');
    expectTypeOf<PluginSource>().not.toHaveProperty('logoUrl');
    expectTypeOf<DeliveredSignature>().not.toHaveProperty('logoUrl');
  });
});
