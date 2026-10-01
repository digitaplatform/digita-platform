import { describe, it, expect } from 'vitest';
import type { EntityDefinition } from '@digitaplatform/shared';
import { localizeMeta } from '@/lib/localize-meta';

/**
 * A workflow button is a text of the entity file, so it speaks the session language like every
 * other label: `transition.<Entity>.<action>` carries its translation, and a transition without
 * a key keeps the text the entity file writes.
 */

const meta = {
  name: 'WorkOrder',
  label: 'Work order',
  fields: [],
  transitions: [
    { from: 'in_repair', to: 'ready', action: 'Ready for pickup', allowed_roles: ['Mechanic'] },
    { from: 'ready', to: 'closed', action: 'Hand over', allowed_roles: [] },
    { from: 'draft', to: 'open', allowed_roles: [] },
  ],
} as unknown as EntityDefinition;

const t: Record<string, string> = {
  'transition.WorkOrder.Ready for pickup': 'Prêt pour le retrait',
};

describe('localizeMeta transitions', () => {
  const out = localizeMeta(meta, t);
  const action = (i: number) => out.transitions![i]!.action;

  it('translates a transition label by its entity and action', () => {
    expect(action(0)).toBe('Prêt pour le retrait');
  });

  it('keeps the written label where no key exists', () => {
    expect(action(1)).toBe('Hand over');
  });

  it('leaves a transition without an action without one, so the button shows its state', () => {
    expect(action(2)).toBeUndefined();
  });

  it('keeps what is not a label of a transition', () => {
    expect(out.transitions![0]).toMatchObject({ from: 'in_repair', to: 'ready', allowed_roles: ['Mechanic'] });
  });

  it('does not mutate the input meta', () => {
    expect(meta.transitions![0]!.action).toBe('Ready for pickup');
  });

  it('adds no transitions to an entity without any', () => {
    const plain = { name: 'Note', label: 'Note', fields: [] } as unknown as EntityDefinition;
    expect(localizeMeta(plain, t)).not.toHaveProperty('transitions');
  });
});
