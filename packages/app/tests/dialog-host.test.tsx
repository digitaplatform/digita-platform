// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { DialogHostProvider, useDialogHost } from '@/components/overlay/DialogHost';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

const MESSAGE = 'Submitting freezes the customer and the prices on this order.';

function Operator({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { confirm, toast } = useDialogHost();
  return (
    <>
      <button type="button" onClick={() => toast('Saved', 'success')}>
        save
      </button>
      <button type="button" onClick={() => void confirm({ title: 'Submit SO-0042?', message: MESSAGE }).then(onAnswer)}>
        submit
      </button>
    </>
  );
}

describe('DialogHostProvider', () => {
  it('shows a toast through the kit Toast, dismissed by the chrome close text', () => {
    render(
      <DialogHostProvider>
        <Operator onAnswer={() => {}} />
      </DialogHostProvider>,
    );
    fireEvent.click(screen.getByText('save'));
    const toast = document.querySelector('[data-ui="toast-viewport"] > [data-ui="toast"]');
    expect(toast).toHaveAttribute('data-type', 'success');
    expect(toast).toHaveTextContent('Saved');
    const dismiss = screen.getByRole('button', { name: 'ui.action.close' });
    expect(dismiss).toHaveAttribute('data-ui', 'toast-dismiss');
    fireEvent.click(dismiss);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('puts the confirm message bare into the kit dialog-body and returns focus after the answer', async () => {
    const onAnswer = vi.fn();
    render(
      <DialogHostProvider>
        <Operator onAnswer={onAnswer} />
      </DialogHostProvider>,
    );
    const opener = screen.getByText('submit');
    opener.focus();
    fireEvent.click(opener);

    const body = document.querySelector('[data-ui="dialog"] [data-ui="dialog-body"]')!;
    expect(body).toHaveTextContent(MESSAGE);
    // A wrapper around the copy would be app markup no design can reach.
    expect(body.childElementCount).toBe(0);
    expect(screen.getByRole('button', { name: 'ui.action.confirm' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'ui.action.confirm' }));
    await act(async () => {});
    expect(onAnswer).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});
