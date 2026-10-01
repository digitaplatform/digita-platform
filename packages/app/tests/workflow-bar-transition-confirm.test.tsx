// @vitest-environment jsdom
// A workshop lead taps "Ready for pickup" on a tablet. A transition with `confirm: true` asks
// first and moves the state only after a yes; a no leaves the work order as it is. A transition
// without `confirm` moves at once, as before.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, TransitionDefinition } from '@digitaplatform/shared';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  toast: vi.fn(),
  transition: vi.fn(),
}));

vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: { user: { roles: string[] } }) => unknown) => sel({ user: { roles: ['Lead'] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ t: (k: string) => k, tOption: (_e: string, _f: string, v: string) => `state:${v}` }),
}));
// The keys stand for the texts; the params show which state a text is about.
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));
vi.mock('@/hooks/useDocument', () => {
  const other = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useSubmit: other,
    useCancel: other,
    useAmend: other,
    useCopy: other,
    useTransition: () => ({ mutateAsync: mocks.transition, isPending: false }),
  };
});
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

import { WorkflowBar } from '@/components/workflow/WorkflowBar';

function drawBar(transition: TransitionDefinition, onApplied = vi.fn()) {
  const meta = {
    name: 'WorkOrder',
    fields: [{ fieldname: 'status', fieldtype: 'Select', label: 'Status', options: ['in_progress', 'ready_for_pickup'] }],
    permissions: [],
    workflow_field: 'status',
    states: [{ name: 'in_progress', is_initial: true }, { name: 'ready_for_pickup' }],
    transitions: [transition],
  } as unknown as EntityDefinition;
  render(
    <WorkflowBar entity="WorkOrder" meta={meta} name="WO-1" doc={{ status: 'in_progress' }} disabled={false} onApplied={onApplied} />,
  );
  return onApplied;
}

const toPickup: TransitionDefinition = {
  from: 'in_progress',
  to: 'ready_for_pickup',
  action: 'Ready for pickup',
  allowed_roles: ['Lead'],
  confirm: true,
};

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.toast.mockReset();
  mocks.transition.mockReset().mockResolvedValue({ _id: 'WO-1', status: 'ready_for_pickup' });
});

describe('a transition with confirm', () => {
  it('asks which state it moves to, and moves only after a yes', async () => {
    let answer: (yes: boolean) => void = () => {};
    mocks.confirm.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    const onApplied = drawBar(toPickup);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Ready for pickup' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm.mock.calls[0]![0].title).toBe('ui.workflow.transitionConfirm {"state":"state:ready_for_pickup"}');
    expect(mocks.transition).not.toHaveBeenCalled();

    await act(async () => answer(true));

    await waitFor(() => expect(mocks.transition).toHaveBeenCalledWith({ name: 'WO-1', to: 'ready_for_pickup' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ _id: 'WO-1', status: 'ready_for_pickup' }));
  });

  it('leaves the document as it is after a no', async () => {
    mocks.confirm.mockResolvedValue(false);
    const onApplied = drawBar(toPickup);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Ready for pickup' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('a transition without confirm', () => {
  it('moves the state at once, without a question', async () => {
    const onApplied = drawBar({ from: 'in_progress', to: 'ready_for_pickup', action: 'Ready for pickup', allowed_roles: ['Lead'] });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Ready for pickup' }));

    await waitFor(() => expect(mocks.transition).toHaveBeenCalledWith({ name: 'WO-1', to: 'ready_for_pickup' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
