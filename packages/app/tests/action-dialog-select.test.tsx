// @vitest-environment jsdom
// A workshop lead opens "Create work order" on a Booking. Its dialog asks the category of a new bike
// in a Select. The list must open above the dialog, or no click and no tap can reach it, and its
// options must read in the person's language, not as the codes the action file writes.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActionDefinition } from '@digitaplatform/shared';
import { zIndex } from '@digitaplatform/theme';
import { useI18nStore } from '@/stores/i18n';

const workOrder = {
  label: 'Create work order',
  action: 'create_work_order',
  opens_dialog: true,
  dialog_fields: [
    { fieldname: 'bike_category', fieldtype: 'Select', label: 'Category', options: ['gravel', 'mtb', 'ebike_city'] },
  ],
} as unknown as ActionDefinition;

vi.mock('@/services/resource', async (orig) => ({
  ...(await orig<typeof import('@/services/resource')>()),
  getActions: async () => ({ success: true, data: [workOrder] }),
  runAction: vi.fn(),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { ActionBar } from '@/components/workflow/ActionBar';

/** The value of the layer token a surface carries, read from its `z-<token>` class. */
function layer(el: Element | null): number {
  const token = /(?:^|\s)z-(\w+)(?:\s|$)/.exec(el?.className ?? '')?.[1];
  const value = token ? (zIndex as Record<string, string>)[token] : undefined;
  if (value === undefined) throw new Error(`no layer token on ${el?.outerHTML.slice(0, 80)}`);
  return Number(value);
}

async function openCategory(translations: Record<string, string>) {
  useI18nStore.setState({ translations: { 'action.Booking.create_work_order': 'Werkstattauftrag', ...translations }, loaded: true });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ActionBar entity="Booking" name="B-1" disabled={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Werkstattauftrag' }));
  const dialog = await screen.findByRole('dialog');
  const select = await within(dialog).findByRole('combobox');
  await user.click(select);
  return { user, dialog, select, listbox: screen.getByRole('listbox') };
}

describe('a Select in the dialog an action opens', () => {
  it('opens its list on a layer above the dialog, and a click picks a value', async () => {
    const { user, dialog, select, listbox } = await openCategory({});
    const overlay = dialog.closest('[data-ui="dialog-overlay"]');
    expect(layer(listbox.closest('[data-ui="popover"]'))).toBeGreaterThan(layer(overlay));
    await user.click(within(listbox).getByRole('option', { name: 'mtb' }));
    expect(select).toHaveTextContent('mtb');
  });

  it('names its options by action_option.<Entity>.<action>.<field>.<value>', async () => {
    const { listbox } = await openCategory({
      'action_option.Booking.create_work_order.bike_category.gravel': 'Gravelbike',
      'option.Booking.bike_category.gravel': 'Kies (Feld der Entität)',
    });
    expect(within(listbox).getByRole('option', { name: 'Gravelbike' })).toBeInTheDocument();
  });

  it('keeps the text of the entity field of the same name, and the code where no text exists', async () => {
    const { listbox } = await openCategory({ 'option.Booking.bike_category.mtb': 'Mountainbike' });
    const names = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['—', 'gravel', 'Mountainbike', 'ebike_city']);
  });
});
