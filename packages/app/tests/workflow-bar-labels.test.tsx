// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EntityDefinition } from '@digitaplatform/shared';
import { localizeMeta } from '@/lib/localize-meta';

/**
 * The buttons of a workflow speak the session language. A transition with an `action` shows its
 * translated label (`transition.<Entity>.<action>`, resolved by localizeMeta); one without shows
 * its target state by the text the state badge uses (`option.<Entity>.<workflow field>.<state>`).
 */

const texts = vi.hoisted(() => ({ map: {} as Record<string, string> }));

vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Mechanic'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      t: (k: string) => k,
      tOption: (entity: string, field: string, value: string) => texts.map[`option.${entity}.${field}.${value}`] ?? value,
    }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }),
}));
vi.mock('@/hooks/useDocument', () => {
  const m = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false });
  return { useSubmit: m, useCancel: m, useAmend: m, useTransition: m };
});
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import { WorkflowBar } from '@/components/workflow/WorkflowBar';

const meta = {
  name: 'WorkOrder',
  label: 'Work order',
  fields: [],
  permissions: [],
  workflow_field: 'stage',
  states: [{ value: 'in_repair', color: 'amber' }, { value: 'ready', color: 'green' }],
  transitions: [
    { from: 'in_repair', to: 'ready', action: 'Ready for pickup', allowed_roles: ['Mechanic'] },
    { from: 'in_repair', to: 'waiting', allowed_roles: ['Mechanic'] },
  ],
} as unknown as EntityDefinition;

function renderBar(localized: EntityDefinition) {
  render(
    <WorkflowBar
      entity="WorkOrder"
      meta={localized}
      name="WO-1"
      doc={{ stage: 'in_repair', docstatus: 0 }}
      disabled={false}
      onApplied={() => {}}
    />,
  );
}

describe('WorkflowBar button labels', () => {
  it('shows the translated label of a transition with an action', () => {
    texts.map = {};
    renderBar(localizeMeta(meta, { 'transition.WorkOrder.Ready for pickup': 'Prêt pour le retrait' }));
    expect(screen.getByRole('button', { name: 'Prêt pour le retrait' })).toBeInTheDocument();
  });

  it('shows the written label where the action has no key', () => {
    texts.map = {};
    renderBar(localizeMeta(meta, {}));
    expect(screen.getByRole('button', { name: 'Ready for pickup' })).toBeInTheDocument();
  });

  it('labels a transition without an action by the translated text of its target state', () => {
    texts.map = { 'option.WorkOrder.stage.waiting': 'En attente de pièces' };
    renderBar(localizeMeta(meta, {}));
    expect(screen.getByRole('button', { name: 'En attente de pièces' })).toBeInTheDocument();
  });

  it('labels a transition without an action by its state as written where the state has no text', () => {
    texts.map = {};
    renderBar(localizeMeta(meta, {}));
    expect(screen.getByRole('button', { name: 'waiting' })).toBeInTheDocument();
  });
});
