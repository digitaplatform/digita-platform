// @vitest-environment jsdom
// The tree editor's partition choice for a `kind` column, written as a Select field. An app may write that
// field's options as one newline-separated string, which the record form's Select accepts: the
// tree editor offers one group per line, as the Select does, and loads the first group's tree.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EntityDefinition, TreeConfig } from '@digitaplatform/shared';

const listCalls = vi.hoisted(() => [] as Array<{ filters?: unknown[] }>);
vi.mock('@/hooks/useList', () => ({
  useList: (_entity: string, params: { filters?: unknown[] }) => {
    listCalls.push(params);
    return { data: { rows: [] }, isLoading: false, isError: false };
  },
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));
vi.mock('@/services/resource', () => ({
  updateDoc: vi.fn(async () => ({})),
  deleteDoc: vi.fn(async () => ({})),
}));
vi.mock('@/components/record/RecordDialog', () => ({
  RecordDialog: () => null,
}));

import { TreeEditor } from '@/components/render/TreeEditor';
import { DialogHostProvider } from '@/components/overlay/DialogHost';

const TREE: TreeConfig = { kind: true };

function renderEditor(options: string[] | string) {
  const meta = {
    name: 'AccountGroup',
    title_field: 'name',
    fields: [{ fieldname: 'kind', fieldtype: 'Select', label: 'Kind', options }],
  } as unknown as EntityDefinition;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <TreeEditor entity="AccountGroup" meta={meta} tree={TREE} />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
}

async function readOfferedGroups(): Promise<string[]> {
  await userEvent.setup().click(screen.getByRole('combobox', { name: 'Kind' }));
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}

beforeEach(() => {
  listCalls.length = 0;
});

describe('TreeEditor group choice', () => {
  it('offers one group per line of options written as one string, and loads the first group', async () => {
    renderEditor('Sales\n Purchase \n\nStock');
    expect(listCalls.at(-1)?.filters).toEqual([['kind', '=', 'Sales']]);
    expect(await readOfferedGroups()).toEqual(['Sales', 'Purchase', 'Stock']);
  });

  it('offers the options written as a list, as before', async () => {
    renderEditor(['Sales', 'Purchase']);
    expect(listCalls.at(-1)?.filters).toEqual([['kind', '=', 'Sales']]);
    expect(await readOfferedGroups()).toEqual(['Sales', 'Purchase']);
  });
});
