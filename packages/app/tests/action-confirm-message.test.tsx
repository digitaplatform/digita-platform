// @vitest-environment jsdom
// The workshop lead runs "Book parts", an action that moves stock and asks first. The question
// must say what the action will do, in the words its author gave or the tenant's translation of
// them; an action without such words still asks by its label alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ActionDefinition } from '@digitaplatform/shared';

const mocks = vi.hoisted(() => ({ actions: [] as unknown[], mutateAsync: vi.fn() }));

vi.mock('@/hooks/useActions', () => ({
  useActions: () => ({ data: mocks.actions }),
  useRunAction: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

import { ActionBar } from '@/components/workflow/ActionBar';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useI18nStore } from '@/stores/i18n';

const bookParts: ActionDefinition = {
  label: 'Book parts',
  action: 'bookParts',
  confirm: true,
  confirm_message: 'Takes the parts of this work order out of stock.',
};

async function openConfirm(action: ActionDefinition) {
  mocks.actions = [action];
  render(
    <MemoryRouter>
      <DialogHostProvider>
        <ActionBar entity="WorkOrder" name="WO-1" disabled={false} />
      </DialogHostProvider>
    </MemoryRouter>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: action.label }));
  return screen.findByRole('dialog');
}

afterEach(() => {
  useI18nStore.setState({ translations: {} });
  mocks.mutateAsync.mockReset();
});

describe('the confirm of an action', () => {
  it('says what the action does, in the words of its author', async () => {
    const dialog = await openConfirm(bookParts);

    expect(within(dialog).getByText('Run “Book parts”?')).toBeVisible();
    expect(within(dialog).getByText('Takes the parts of this work order out of stock.')).toBeVisible();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('says it in the tenant translation of those words', async () => {
    useI18nStore.setState({
      translations: { 'action.WorkOrder.bookParts.confirm_message': 'Bucht die Teile dieses Auftrags aus dem Lager.' },
    });

    const dialog = await openConfirm(bookParts);

    expect(within(dialog).getByText('Bucht die Teile dieses Auftrags aus dem Lager.')).toBeVisible();
    expect(within(dialog).queryByText('Takes the parts of this work order out of stock.')).toBeNull();
  });

  it('asks by the label alone for an action without such words', async () => {
    const dialog = await openConfirm({ label: 'Cancel order', action: 'cancelOrder', confirm: true });

    expect(within(dialog).getByText('Run “Cancel order”?')).toBeVisible();
    expect(dialog.querySelector('[data-ui="dialog-body"]')).toHaveTextContent(/^$/);
  });
});
