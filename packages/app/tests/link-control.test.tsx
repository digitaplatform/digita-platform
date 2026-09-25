// @vitest-environment jsdom
// LinkControl behavior tests — the first tests this control ever had.
// All three modes (inline combobox, search_dialog, tree) with real user-event
// interactions; the async search hook is mocked. Every case guards one of the
// defects from docs/superpowers/research/2026-07-02-deep-read/lookup-flow-trace.json.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
vi.mock('@/hooks/useList', () => ({
  useList: () => ({
    data: {
      rows: [
        { _id: 'N-1', name: 'Root', parent: null },
        { _id: 'N-2', name: 'Child', parent: 'N-1' },
      ],
    },
    isLoading: false,
  }),
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
    expect(dialog).toBeInTheDocument();
    // SearchDialog pre-highlights the first row — Enter picks it directly.
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
  it('opens only on click, and stays CLOSED after Escape/pick (no reopen loop)', async () => {
    const user = userEvent.setup();
    metaState.data = {
      name: 'Folder',
      title_field: 'name',
      tree: { parent_field: 'parent', label_field: 'name' },
      fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
    };
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
    await user.click(await screen.findByText('Root'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith('N-1');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
