// @vitest-environment jsdom
// The workshop lead runs "Create quote" on a work order. The app opens the new quote, and its
// toast must say that the quote was made and which one, not repeat the label of the button as
// if it were a command. An action that creates nothing must still say that it ran.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

async function run(action: ActionDefinition, result: Record<string, unknown>) {
  mocks.actions = [action];
  mocks.mutateAsync.mockResolvedValue({ result, dialog_data: {} });
  render(
    <MemoryRouter initialEntries={['/WorkOrder/WO-7']}>
      <DialogHostProvider>
        <ActionBar entity="WorkOrder" name="WO-7" disabled={false} />
      </DialogHostProvider>
    </MemoryRouter>,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: action.label }));
}

afterEach(() => {
  useI18nStore.setState({ translations: {} });
  mocks.mutateAsync.mockReset();
});

describe('the toast of an action that succeeded', () => {
  it('names the document the action created', async () => {
    await run({ label: 'Create quote', action: 'createQuote' }, { created: { entity: 'Quote', name: 'Q-12' } });

    expect(await screen.findByText('Quote Q-12 created')).toBeVisible();
  });

  it('names the created document by the tenant text of its entity', async () => {
    useI18nStore.setState({ translations: { 'entity.Quote': 'Angebot' } });

    await run({ label: 'Create quote', action: 'createQuote' }, { created: { entity: 'Quote', name: 'Q-12' } });

    expect(await screen.findByText('Angebot Q-12 created')).toBeVisible();
  });

  it('says that an action which created nothing ran', async () => {
    await run({ label: 'Book parts', action: 'bookParts' }, {});

    expect(await screen.findByText('“Book parts” completed')).toBeVisible();
  });
});
