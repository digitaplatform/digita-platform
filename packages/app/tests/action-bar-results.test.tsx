// @vitest-environment jsdom
// A receptionist runs "Create invoice" on a work order: the app toasts success, then opens the new
// invoice. Another action downloads a file. An action with `confirm: true` asks first, and one that
// opens a dialog collects its fields first. If any of these breaks, the receptionist stays on the
// work order, gets no file, or runs the action without the question.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ActionDefinition } from '@digitaplatform/shared';

const mocks = vi.hoisted(() => ({
  actions: [] as unknown[],
  mutateAsync: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@/hooks/useActions', () => ({
  useActions: () => ({ data: mocks.actions }),
  useRunAction: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));
// The keys stand for the texts; the params show which action a text is about.
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

import { ActionBar } from '@/components/workflow/ActionBar';

function CurrentPath() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function drawBar(actions: ActionDefinition[]) {
  mocks.actions = actions;
  return render(
    <MemoryRouter initialEntries={['/WorkOrder/WO-1']}>
      <ActionBar entity="WorkOrder" name="WO-1" disabled={false} />
      <CurrentPath />
    </MemoryRouter>,
  );
}

function answerWith(result: Record<string, unknown>) {
  mocks.mutateAsync.mockResolvedValue({ result, dialog_data: {} });
}

const succeeded = (action: string) => `ui.action.actionSucceeded ${JSON.stringify({ action })}`;

const createInvoiceAction: ActionDefinition = { label: 'Create invoice', action: 'createInvoiceAction' };

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.toast.mockReset();
  mocks.confirm.mockReset();
});

describe('the success of an action', () => {
  it('runs it on the saved document and toasts that it completed, without the question a confirm would ask', async () => {
    const user = userEvent.setup();
    answerWith({});
    drawBar([createInvoiceAction]);

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(succeeded('Create invoice'), 'success'));
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ name: 'WO-1', action: 'createInvoiceAction', body: undefined });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/WorkOrder/WO-1');
  });

  it('toasts the error of a failing action and does nothing else', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new Error('Stock is short'));
    drawBar([createInvoiceAction]);

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Stock is short', 'error'));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
    expect(screen.getByTestId('where')).toHaveTextContent('/WorkOrder/WO-1');
  });
});

describe('the document an action created', () => {
  it('opens the new document', async () => {
    const user = userEvent.setup();
    answerWith({ created: { entity: 'Invoice', name: 'INV-7' } });
    drawBar([createInvoiceAction]);

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/Invoice/INV-7'));
    expect(mocks.toast).toHaveBeenCalledWith(
      `ui.action.actionCreated ${JSON.stringify({ entity: 'Invoice', name: 'INV-7' })}`,
      'success',
    );
  });

  it('opens a document whose name needs escaping under that name', async () => {
    const user = userEvent.setup();
    answerWith({ created: { entity: 'Invoice', name: 'INV 7/2026' } });
    drawBar([createInvoiceAction]);

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/Invoice/INV%207%2F2026'));
  });

  it('stays on the work order when the result names no complete document', async () => {
    const user = userEvent.setup();
    answerWith({ created: { entity: 'Invoice' } });
    drawBar([createInvoiceAction]);

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(succeeded('Create invoice'), 'success'));
    expect(screen.getByTestId('where')).toHaveTextContent('/WorkOrder/WO-1');
  });
});

describe('the file an action returns', () => {
  const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let blobs: Blob[];
  let saved: Array<{ filename: string; href: string }>;

  beforeEach(() => {
    blobs = [];
    saved = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:file-${blobs.length}`;
    });
    URL.revokeObjectURL = vi.fn();
    // A click on the link of a blob is the browser's save; jsdom would only report it as not implemented.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ filename: this.download, href: this.href });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    URL.createObjectURL = originals.create;
    URL.revokeObjectURL = originals.revoke;
  });

  function readBytes(blob: Blob): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  function readText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }

  async function runDownloadingAction(result: Record<string, unknown>) {
    const user = userEvent.setup();
    answerWith(result);
    drawBar([{ label: 'Download', action: 'download' }]);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  }

  it('saves a base64 file under its name and type, with the bytes the base64 stands for', async () => {
    // Bytes that are no valid UTF-8: they survive only if the content is decoded, not read as text.
    const bytes = [0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80];
    await runDownloadingAction({
      download: { filename: 'invoice.pdf', content_base64: btoa(String.fromCharCode(...bytes)), mime_type: 'application/pdf' },
    });

    expect(saved).toEqual([{ filename: 'invoice.pdf', href: 'blob:file-1' }]);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe('application/pdf');
    expect(await readBytes(blobs[0]!)).toEqual(bytes);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file-1');
  });

  it('saves a text file under its name and type, as UTF-8', async () => {
    await runDownloadingAction({ download: { filename: 'export.csv', content: 'name;city\nGrüße;Zürich\n', mime_type: 'text/csv' } });

    expect(saved).toEqual([{ filename: 'export.csv', href: 'blob:file-1' }]);
    expect(blobs[0]!.type).toBe('text/csv');
    expect(await readText(blobs[0]!)).toBe('name;city\nGrüße;Zürich\n');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:file-1');
  });

  it('saves a file that names no type as a binary', async () => {
    await runDownloadingAction({ download: { filename: 'export.bin', content: 'data' } });

    expect(blobs[0]!.type).toBe('application/octet-stream');
  });

  it('saves the legacy xml and filename shape as an XML file', async () => {
    await runDownloadingAction({ xml: '<Invoice id="INV-7"/>', filename: 'rechnung.xml' });

    expect(saved).toEqual([{ filename: 'rechnung.xml', href: 'blob:file-1' }]);
    expect(blobs[0]!.type).toBe('application/xml');
    expect(await readText(blobs[0]!)).toBe('<Invoice id="INV-7"/>');
  });

  it('saves nothing when the result names a file without content', async () => {
    await runDownloadingAction({ download: { filename: 'empty.pdf' } });

    expect(saved).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('saves nothing for an xml result that names no file', async () => {
    await runDownloadingAction({ xml: '<Invoice/>' });

    expect(saved).toEqual([]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('an action with confirm', () => {
  const cancelOrderAction: ActionDefinition = { label: 'Cancel order', action: 'cancelOrderAction', confirm: true, type: 'danger' };

  it('asks first and runs only after a yes', async () => {
    const user = userEvent.setup();
    answerWith({});
    let resolveConfirm: (yes: boolean) => void = () => {};
    mocks.confirm.mockReturnValue(new Promise<boolean>((resolve) => (resolveConfirm = resolve)));
    drawBar([cancelOrderAction]);

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Cancel order'), confirmLabel: 'Cancel order', danger: true }),
    );
    expect(mocks.mutateAsync).not.toHaveBeenCalled();

    await act(async () => resolveConfirm(true));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ name: 'WO-1', action: 'cancelOrderAction', body: undefined });
    expect(mocks.toast).toHaveBeenCalledWith(succeeded('Cancel order'), 'success');
  });

  it('does not run after a no', async () => {
    const user = userEvent.setup();
    answerWith({});
    mocks.confirm.mockResolvedValue(false);
    drawBar([cancelOrderAction]);

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('asks for a plain action without the danger look', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    drawBar([{ label: 'Archive', action: 'archive', confirm: true }]);

    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: false })));
  });
});

describe('an action that opens a dialog', () => {
  const bookPartsAction: ActionDefinition = {
    label: 'Book parts',
    action: 'bookPartsAction',
    opens_dialog: true,
    // The dialog is the confirmation, so this must not ask a second question.
    confirm: true,
    dialog_fields: [{ fieldname: 'warehouse', fieldtype: 'Data', label: 'Warehouse' }] as ActionDefinition['dialog_fields'],
  };

  it('opens the dialog of its fields instead of asking or running', async () => {
    const user = userEvent.setup();
    drawBar([bookPartsAction]);

    await user.click(screen.getByRole('button', { name: 'Book parts' }));

    const dialog = await screen.findByRole('dialog', { name: 'Book parts' });
    expect(await within(dialog).findByLabelText('Warehouse')).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('runs with the values of the dialog once it is confirmed, and closes it', async () => {
    const user = userEvent.setup();
    answerWith({});
    drawBar([bookPartsAction]);

    await user.click(screen.getByRole('button', { name: 'Book parts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Book parts' });
    await user.type(await within(dialog).findByLabelText('Warehouse'), 'MAIN');
    await user.click(within(dialog).getByRole('button', { name: 'ui.action.confirm' }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ name: 'WO-1', action: 'bookPartsAction', body: { warehouse: 'MAIN' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.toast).toHaveBeenCalledWith(succeeded('Book parts'), 'success');
  });

  it('runs nothing when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    drawBar([bookPartsAction]);

    await user.click(screen.getByRole('button', { name: 'Book parts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Book parts' });
    await user.click(within(dialog).getByRole('button', { name: 'ui.action.cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
