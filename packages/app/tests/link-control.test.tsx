// @vitest-environment jsdom
// LinkControl behavior tests — the first tests this control ever had.
// All three modes (inline combobox, search_dialog, tree) with real user-event
// interactions; the async search hook is mocked. Every case guards one of the
// defects from docs/superpowers/research/2026-07-02-deep-read/lookup-flow-trace.json.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

const searchResults = vi.hoisted(() => ({
  data: [
    { _id: 'O-1', display: 'Alpha' },
    { _id: 'O-2', display: 'Beta' },
  ] as Array<{ _id: string; display: string; fields?: Record<string, unknown> }>,
  isLoading: false,
}));

vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => searchResults,
}));
const metaState = vi.hoisted(() => ({
  data: {
    name: 'Owner',
    search_fields: ['display_name'],
    fields: [{ fieldname: 'display_name', fieldtype: 'Data', label: 'Name' }],
  } as Record<string, unknown>,
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: metaState.data }),
}));
const TREE_ROWS = [
  { _id: 'N-1', name: 'Root', parent: null },
  { _id: 'N-2', name: 'Child', parent: 'N-1' },
  { _id: 'N-3', name: 'Loose', parent: null },
];
// `rows: undefined` is a list still on its way from the network.
const listState = vi.hoisted(() => ({ rows: undefined as Array<Record<string, unknown>> | undefined }));
vi.mock('@/hooks/useList', () => ({
  useList: () => ({
    data: listState.rows ? { rows: listState.rows } : undefined,
    isLoading: !listState.rows,
  }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import LinkControl from '@/controls/LinkControl';
import { useUiStore } from '@/stores/ui';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

function makeField(extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    fieldname: 'owner',
    fieldtype: 'Link',
    label: 'Owner',
    target: 'Owner',
    ...extra,
  } as FieldDefinition;
}

function Host({
  field,
  onChange = () => {},
  onCommit,
  onSubmit = () => {},
  value: initialValue = null,
}: {
  field: FieldDefinition;
  onChange?: (v: unknown) => void;
  onCommit?: () => void;
  onSubmit?: () => void;
  value?: unknown;
}) {
  // Controlled like the real form host: onChange flows back into `value`.
  const [value, setValue] = useState<unknown>(initialValue);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <LinkControl
        field={field}
        value={value}
        doc={{}}
        row={undefined}
        parentDoc={undefined}
        entity="Widget"
        state={STATE}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        onCommit={onCommit}
        controlId="lnk"
        labelId="lnk-label"
      />
      <button type="submit">Save</button>
    </form>
  );
}

beforeEach(() => {
  searchResults.data = [
    { _id: 'O-1', display: 'Alpha' },
    { _id: 'O-2', display: 'Beta' },
  ];
  searchResults.isLoading = false;
  metaState.data = {
    name: 'Owner',
    search_fields: ['display_name'],
    fields: [{ fieldname: 'display_name', fieldtype: 'Data', label: 'Name' }],
  };
});

describe('LinkControl — inline combobox mode', () => {
  it('pick via ArrowDown+Enter calls onChange AND onCommit, closes, shows label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const onSubmit = vi.fn();
    render(<Host field={makeField()} onChange={onChange} onCommit={onCommit} onSubmit={onSubmit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('O-1');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Enter while results are loading never submits the form', async () => {
    const user = userEvent.setup();
    searchResults.data = [];
    searchResults.isLoading = true;
    const onSubmit = vi.fn();
    render(<Host field={makeField()} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Tab with open popup commits the highlight and moves on', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Host field={makeField()} onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith('O-1');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Escape closes only the popup — no commit, form untouched', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onSubmit = vi.fn();
    render(<Host field={makeField()} onCommit={onCommit} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clear (×) resets the value to null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host field={makeField()} value="O-1" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'ui.action.clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('LinkControl — search_dialog mode', () => {
  const dialogField = () =>
    makeField({ search_dialog: true, search_columns: ['display_name'], search_min_chars: 2 });

  it('pick in the dialog commits and the input shows the label IMMEDIATELY', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Host field={dialogField()} onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('Ac{Enter}'); // >= min_chars opens the dialog
    const dialog = await screen.findByRole('dialog');
    // The rows stand for the typed text only once its answer lands; until then they are stale and
    // Enter picks none. SearchDialog pre-highlights the first row; then Enter picks it directly.
    await waitFor(() => expect(within(dialog).getByRole('table')).not.toHaveAttribute('aria-busy'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith('O-1');
    expect(onCommit).toHaveBeenCalledTimes(1);
    // The input must show the picked label right away — not an empty string.
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Alpha');
  });

  it('Tab does NOT open the dialog; Enter below min_chars is consumed silently', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Host field={dialogField()} onSubmit={onSubmit} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('Ac'); // >= min_chars — Tab must still not open
    await user.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(input);
    await user.keyboard('A{Enter}'); // below min_chars
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('LinkControl — tree mode', () => {
  beforeEach(() => {
    metaState.data = {
      name: 'Folder',
      title_field: 'name',
      tree: { parent_field: 'parent', label_field: 'name' },
      fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
    };
    listState.rows = TREE_ROWS;
    useUiStore.setState({ treePickerExpandedIds: {} });
  });

  it('opens only on click, and stays CLOSED after Escape/pick (no reopen loop)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Host field={makeField({ target: 'Folder' })} onChange={onChange} onCommit={onCommit} />);
    const input = screen.getByRole('combobox');

    // Focus alone must NOT open (the old onFocus-open caused the reopen loop).
    input.focus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click opens; Escape closes — and the focus restore to the input must
    // NOT reopen it (the literal un-dismissable-dialog bug).
    await user.click(input);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen, pick a node → closes, commits, STAYS closed.
    await user.click(input);
    await user.click(await screen.findByRole('button', { name: 'ui.tree.select Root' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith('N-1');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens and closes a group on its name, keeps the dialog open and picks nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host field={makeField({ target: 'Folder' })} onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    const dialog = await screen.findByRole('dialog');
    const root = within(dialog).getByRole('button', { name: 'Root' });
    const rootItem = within(dialog).getByRole('treeitem', { name: 'Root' });
    await user.click(root);
    expect(rootItem).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByText('Child')).toBeInTheDocument();
    await user.click(root);
    expect(rootItem).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByText('Child')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picks a group through the Select button in its row and closes the dialog', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Host field={makeField({ target: 'Folder' })} onChange={onChange} onCommit={onCommit} />);
    await user.click(screen.getByRole('combobox'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'ui.tree.select Root' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith('N-1');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('picks a leaf on its name and closes the dialog', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host field={makeField({ target: 'Folder' })} onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Loose' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith('N-3');
  });

  const GROUP_ROWS = [
    { _id: 'G-1', name: 'Retail', parent: null },
    { _id: 'G-2', name: 'Swiss', parent: 'G-1' },
    { _id: 'G-3', name: 'Zurich', parent: 'G-2' },
    { _id: 'G-4', name: 'Wholesale', parent: null },
    { _id: 'G-5', name: 'Germany', parent: 'G-4' },
  ];

  it('starts collapsed with the path to the current value open, also for rows that arrive late', async () => {
    const user = userEvent.setup();
    const field = makeField({ target: 'Folder' });
    listState.rows = undefined;
    const view = render(<Host field={field} value="G-3" />);
    await user.click(screen.getByRole('combobox'));
    const dialog = await screen.findByRole('dialog');
    listState.rows = GROUP_ROWS;
    view.rerender(<Host field={field} value="G-3" />);
    expect(within(dialog).getByRole('treeitem', { name: 'Retail' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('treeitem', { name: 'Swiss' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('treeitem', { name: 'Wholesale' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).getByText('Zurich')).toBeInTheDocument();
    expect(within(dialog).queryByText('Germany')).toBeNull();
  });

  it('keeps the groups a person opened for the next open of a picker of the same target', async () => {
    const user = userEvent.setup();
    const field = makeField({ target: 'Folder' });
    listState.rows = GROUP_ROWS;
    const first = render(<Host field={field} value="G-3" />);
    await user.click(screen.getByRole('combobox'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Wholesale' }));
    await user.click(within(dialog).getByRole('button', { name: 'Retail' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const expectOpenAsLeft = async () => {
      await user.click(screen.getByRole('combobox'));
      const reopened = await screen.findByRole('dialog');
      expect(within(reopened).getByRole('treeitem', { name: 'Wholesale' })).toHaveAttribute('aria-expanded', 'true');
      expect(within(reopened).getByRole('treeitem', { name: 'Retail' })).toHaveAttribute('aria-expanded', 'false');
      expect(within(reopened).getByText('Germany')).toBeInTheDocument();
      expect(within(reopened).queryByText('Swiss')).toBeNull();
    };
    await expectOpenAsLeft();
    first.unmount();
    // Another record's form: its picker of the same target opens as the person left it.
    const second = render(<Host field={field} value={null} />);
    await expectOpenAsLeft();
    second.unmount();

    // A picker of another target keeps its own groups.
    render(<Host field={makeField({ target: 'Region' })} value={null} />);
    await user.click(screen.getByRole('combobox'));
    const other = await screen.findByRole('dialog');
    expect(within(other).getByRole('treeitem', { name: 'Wholesale' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('leaves the kept groups as they were when a name is clicked during a search', async () => {
    const user = userEvent.setup();
    listState.rows = GROUP_ROWS;
    render(<Host field={makeField({ target: 'Folder' })} value="G-3" />);
    await user.click(screen.getByRole('combobox'));
    const dialog = await screen.findByRole('dialog');
    const search = within(dialog).getByRole('searchbox');
    await user.type(search, 'Zur');
    await user.click(within(dialog).getByRole('button', { name: 'Retail' }));
    expect(useUiStore.getState().treePickerExpandedIds.Folder).toBeUndefined();
    await user.clear(search);
    expect(within(dialog).getByRole('treeitem', { name: 'Retail' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByText('Zurich')).toBeInTheDocument();
  });
});
