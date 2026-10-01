import { describe, it, expectTypeOf } from 'vitest';
import type { Design } from '@digitaplatform/theme';
import type { SignaturePlugin } from '@digitaplatform/plugins';

/**
 * A key the host never reads promises a designer what nobody gets: a design's density changed no
 * spacing, because the density triples follow the density a person or tenant picks, never the
 * design, and a signature plugin's logoUrl showed no logo, because the chrome draws the tenant's
 * logo, the monogram or the wordmark. Neither type offers the key, and the type check holds a
 * plugin to that.
 */
describe('a design and a signature plugin', () => {
  it('offer no key the host never reads', () => {
    expectTypeOf<Design>().not.toHaveProperty('density');
    expectTypeOf<SignaturePlugin>().not.toHaveProperty('logoUrl');
  });
});
