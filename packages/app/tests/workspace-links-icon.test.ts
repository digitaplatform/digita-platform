import { describe, it, expect, expectTypeOf } from 'vitest';
import type { LinksCard } from '@digitaplatform/shared';
import { validateWorkspaceCards } from '@/lib/workspace-schema';

/**
 * A links card draws each entry as its label and no icon. An author who set icon on an entry got
 * no icon and no word, so an entry offers no such key, and a workspace whose links card sets it
 * fails to load, naming it.
 */

const LINKS = {
  id: 'help',
  kind: 'links',
  label: 'Help',
  links: [
    { label: 'All books', to: '/Book' },
    { label: 'Library of Congress', href: 'https://www.loc.gov/' },
  ],
};

describe('icon on a links card entry', () => {
  it('is no key of the entry', () => {
    expectTypeOf<LinksCard['links'][number]>().not.toHaveProperty('icon');
  });

  it('PLANTED DEFECT: fails the workspace that sets it, naming the card, the entry and the key', () => {
    const iconed = { ...LINKS, links: [LINKS.links[0], { label: 'Authors', to: '/Author', icon: 'user' }] };
    expect(() => validateWorkspaceCards([iconed])).toThrow(/^workspace_cards_invalid: 0\.links\.1\.icon: .*label/);
  });

  it('PLANTED INNOCENT: passes a links card whose entries set no icon, and a card with an icon of its own', () => {
    const shortcut = { id: 'new-book', kind: 'shortcut', label: 'New book', icon: 'plus', to: '/Book/new' };
    expect(validateWorkspaceCards([LINKS, shortcut])).toEqual([LINKS, shortcut]);
  });
});
