// @vitest-environment jsdom
// A person fills the dialog of "Create work order" and the server refuses: the customer's bike is
// missing. The dialog must stay open with what the person typed, and show the reason at the field
// it names, or above the form, in the person's language.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ActionDefinition, ApiResponse } from '@digitaplatform/shared';
import { ApiClientError } from '@/lib/errors';
import { useI18nStore } from '@/stores/i18n';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), toast: vi.fn() }));

const workOrder: ActionDefinition = {
  label: 'Create work order',
  action: 'create_work_order',
  opens_dialog: true,
  dialog_fields: [
    { fieldname: 'bike', fieldtype: 'Data', label: 'Bike' },
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
  ] as ActionDefinition['dialog_fields'],
};

vi.mock('@/hooks/useActions', () => ({
  useActions: () => ({ data: [workOrder] }),
  useRunAction: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { ActionBar } from '@/components/workflow/ActionBar';

/** The engine's answer to a refusal, as its error handler writes it for a hook that names a key. */
function refuse(message: { text: string; path?: string; params?: Record<string, string> }) {
  const body = {
    success: false,
    status_code: 422,
    data: null,
    messages: [{ type: 'error', show: true, ...message }],
    error: { code: 'BUSINESS_RULE_VIOLATION', detail: 'refused', trace_id: 't' },
  } as ApiResponse;
  mocks.mutateAsync.mockRejectedValue(new ApiClientError('refused', 422, body));
}

async function fillAndConfirm() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <ActionBar entity="Booking" name="B-1" disabled={false} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Create work order' }));
  const dialog = await screen.findByRole('dialog', { name: 'Create work order' });
  await user.type(await within(dialog).findByLabelText('Note'), 'brakes squeak');
  await user.click(within(dialog).getByRole('button', { name: 'ui.action.confirm' }));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
  return { user, dialog };
}

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.toast.mockReset();
  useI18nStore.setState({
    translations: { 'workshop.pick_bike': 'Wähle das Rad von {customer} oder gib ein neues an.' },
    loaded: true,
  });
});

describe('a refusal of the action a dialog runs', () => {
  it('keeps the dialog and its input, and shows the reason at the field it names', async () => {
    refuse({ text: 'workshop.pick_bike', path: 'bike', params: { customer: 'Anna' } });
    const { dialog } = await fillAndConfirm();

    const bike = await within(dialog).findByLabelText('Bike');
    await waitFor(() => expect(bike).toHaveAttribute('aria-invalid', 'true'));
    const message = 'Wähle das Rad von Anna oder gib ein neues an.';
    expect(within(dialog).getByText(message)).toBeInTheDocument();
    expect(bike.getAttribute('aria-describedby')).toContain(within(dialog).getByText(message).id);
    expect(within(dialog).getByLabelText('Note')).toHaveValue('brakes squeak');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('shows a reason that names no field of the dialog above the form', async () => {
    refuse({ text: 'The workshop is closed today.' });
    const { dialog } = await fillAndConfirm();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The workshop is closed today.');
    expect(within(dialog).getByLabelText('Note')).toHaveValue('brakes squeak');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('runs again with the corrected input, and closes once the action succeeds', async () => {
    refuse({ text: 'The workshop is closed today.' });
    const { user, dialog } = await fillAndConfirm();
    await within(dialog).findByRole('alert');

    mocks.mutateAsync.mockResolvedValue({ result: {} });
    await user.type(within(dialog).getByLabelText('Bike'), 'B-7');
    await user.click(within(dialog).getByRole('button', { name: 'ui.action.confirm' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      name: 'B-1',
      action: 'create_work_order',
      body: { bike: 'B-7', note: 'brakes squeak' },
    });
  });
});
