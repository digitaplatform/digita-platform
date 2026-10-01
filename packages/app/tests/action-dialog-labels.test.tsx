// @vitest-environment jsdom
// A person who works in German clicks "Annehmen" on a quote. The dialog it opens labels its fields
// with the texts of `action_field.<Entity>.<action>.<field>`. Where a dialog field has no such key,
// it keeps the text of the entity field of the same name, which is what the dialog showed before
// that key existed, and else the label the entity file writes.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActionDefinition } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';

const accept = {
  label: 'Accept',
  action: 'accept',
  opens_dialog: true,
  dialog_fields: [
    { fieldname: 'accepted_by', fieldtype: 'Data', label: 'Accepted by' },
    { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
  ],
} as unknown as ActionDefinition;

// The engine's answer for the record's actions: the action as the entity file writes it.
vi.mock('@/services/resource', async (orig) => ({
  ...(await orig<typeof import('@/services/resource')>()),
  getActions: async () => ({ success: true, data: [accept] }),
  runAction: vi.fn(),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import { ActionBar } from '@/components/workflow/ActionBar';

async function openDialog(translations: Record<string, string>) {
  useI18nStore.setState({ translations: { 'action.Quote.accept': 'Annehmen', ...translations }, loaded: true });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ActionBar entity="Quote" name="Q-1" disabled={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Annehmen' }));
  const dialog = await screen.findByRole('dialog');
  // The controls load on demand, so the dialog draws its fields after it opens.
  const boxes = await within(dialog).findAllByRole('textbox');
  return boxes.map((box) => document.getElementById(box.getAttribute('aria-labelledby')!)?.textContent);
}

describe('the field labels of the dialog an action opens on the record page', () => {
  it('come from action_field.<Entity>.<action>.<field>', async () => {
    const labels = await openDialog({ 'action_field.Quote.accept.accepted_by': 'Angenommen von' });
    expect(labels).toEqual(['Angenommen von', 'Note']);
  });

  it('keep the text of the entity field of the same name where the dialog field has no key', async () => {
    const labels = await openDialog({ 'field.Quote.note': 'Notiz' });
    expect(labels).toEqual(['Accepted by', 'Notiz']);
  });
});
