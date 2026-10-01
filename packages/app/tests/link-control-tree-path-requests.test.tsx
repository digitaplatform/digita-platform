// @vitest-environment jsdom
// The requests behind a tree node's path, through the real list hook and a real query client: only
// the engine's list endpoint is stubbed, and it answers each request when the test releases it.
// A Link to an entity without a tree reads no path, and a request for the next level up keeps the
// rows of the previous one as placeholder data, which must never show as a shorter path.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

type Row = Record<string, unknown>;
type ListParams = { filters?: [string, string, unknown][]; page_size?: number };
const engine = vi.hoisted(() => ({
  rows: [] as Row[],
  requestedEntities: [] as string[],
  answers: [] as Array<() => void>,
}));
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/resource')>()),
  // Answers as the engine does: only the rows whose _id an `in` filter names.
  getList: (entity: string, params: ListParams) => {
    engine.requestedEntities.push(entity);
    const ids = params.filters?.find(([field, op]) => field === '_id' && op === 'in')?.[2] as string[] | undefined;
    const rows = engine.rows.filter((r) => !ids || ids.includes(r._id as string));
    const meta = { total: rows.length, page: 1, page_size: params.page_size ?? 20, total_pages: 1 };
    return new Promise((resolve) => engine.answers.push(() => resolve({ success: true, data: rows, meta })));
  },
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: (entity: string) => ({
    data:
      entity === 'CustomerGroup'
        ? { name: entity, title_field: 'name', tree: { parent_field: 'parent', label_field: 'name' }, fields: [] }
        : { name: entity, title_field: 'name', fields: [] },
  }),
}));
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import LinkControl from '@/controls/LinkControl';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

/** Renders a Link field as a form does: the node's own title arrives with the document. */
function renderLinkField(target: string, value: string, title: string) {
  const field = { fieldname: 'link', fieldtype: 'Link', label: 'Link', target } as FieldDefinition;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LinkControl
        field={field}
        value={value}
        doc={{ _link_titles: { link: title } }}
        entity="Customer"
        state={STATE}
        onChange={() => {}}
        controlId={`link-${target}`}
        labelId={`link-${target}-label`}
      />
    </QueryClientProvider>,
  );
}

const readFieldText = () => (screen.getByRole('combobox') as HTMLInputElement).value;

/** Answers the oldest open request and waits until the field asked for the next one, if any. */
async function answerNextRequest(requestsBefore: number) {
  await act(async () => engine.answers.shift()!());
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return engine.requestedEntities.length > requestsBefore;
}

beforeEach(() => {
  engine.rows = [
    { _id: 'G-1', name: 'Business customers', parent: null },
    { _id: 'G-2', name: 'Hotels', parent: 'G-1' },
    { _id: 'G-5', name: 'Spa hotels', parent: 'G-2' },
  ];
  engine.requestedEntities.length = 0;
  engine.answers.length = 0;
});

describe('LinkControl requests for a tree path', () => {
  it('sends none for a Link to an entity without a tree, while a tree Link reads its path', async () => {
    renderLinkField('Country', 'CH', 'Switzerland');
    renderLinkField('CustomerGroup', 'G-5', 'Spa hotels');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(engine.requestedEntities).not.toContain('Country');
    expect(engine.requestedEntities).toContain('CustomerGroup');
  });

  it('shows the node title until the whole path is read, never a part of it', async () => {
    renderLinkField('CustomerGroup', 'G-5', 'Spa hotels');
    await waitFor(() => expect(engine.answers).toHaveLength(1));
    const shownTexts = [readFieldText()];
    while (await answerNextRequest(engine.requestedEntities.length)) shownTexts.push(readFieldText());
    shownTexts.push(readFieldText());
    expect([...new Set(shownTexts)]).toEqual(['Spa hotels', 'Business customers › Hotels › Spa hotels']);
  });
});
