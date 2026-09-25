// @vitest-environment jsdom
// An action handler runs in the engine, behind the ingress that strips the app's base path, so
// the URL it returns to open is a root path of the engine (/api/v1/...). The client is the only
// side that knows the base, and opens that path under it.
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__APP_BASE_PATH__ = '/erp';
});

const mutateAsync = vi.fn();
vi.mock('@/hooks/useActions', () => ({
  useActions: () => ({ data: [{ action: 'print', label: 'Print' }] }),
  useRunAction: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActionBar } from '@/components/workflow/ActionBar';

describe('an action result that opens a URL, under the base path /erp', () => {
  it('opens an engine root path under the base, and an absolute URL as given', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <MemoryRouter>
        <ActionBar entity="Invoice" name="INV-1" disabled={false} />
      </MemoryRouter>,
    );

    mutateAsync.mockResolvedValueOnce({ result: { open_url: '/api/v1/report/definitions/invoice/render?name=INV-1' }, dialog_data: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenLastCalledWith('/erp/api/v1/report/definitions/invoice/render?name=INV-1', '_blank', 'noopener');

    mutateAsync.mockResolvedValueOnce({ result: { open_url: 'https://acme.example/report/x' }, dialog_data: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenLastCalledWith('https://acme.example/report/x', '_blank', 'noopener');
  });
});
