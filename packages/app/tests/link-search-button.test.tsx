// @vitest-environment jsdom
// A `search_dialog` Link draws an inline search button unless its field says `search_button: false`,
// which makes it a pure type-and-Enter input, as the line-entry grids of a workshop want it. The
// button must go when the field asks and stay otherwise, and the picker must still open by Enter.
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: [{ _id: 'P-1', display: 'Brake pad' }], isLoading: false }),
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({
    data: { name: 'Part', search_fields: ['display_name'], fields: [{ fieldname: 'display_name', fieldtype: 'Data', label: 'Name' }] },
  }),
}));
vi.mock('@/hooks/useList', () => ({ useList: () => ({ data: { rows: [] }, isLoading: false }) }));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

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

function buildPartField(extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    fieldname: 'part',
    fieldtype: 'Link',
    label: 'Part',
    target: 'Part',
    search_dialog: true,
    search_columns: ['display_name'],
    ...extra,
  } as FieldDefinition;
}

function Host({ field, initial = null }: { field: FieldDefinition; initial?: unknown }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <LinkControl
      field={field}
      value={value}
      doc={{}}
      row={undefined}
      parentDoc={undefined}
      entity="Line"
      state={STATE}
      onChange={setValue}
      controlId="part"
      labelId="part-label"
    />
  );
}

const SEARCH_BUTTON = { name: 'ui.list.search' };

describe('the search button of a search_dialog Link', () => {
  it('is drawn when the field does not name search_button', () => {
    render(<Host field={buildPartField()} />);
    expect(screen.getByRole('button', SEARCH_BUTTON)).toBeInTheDocument();
  });

  it('is drawn when search_button is true', () => {
    render(<Host field={buildPartField({ search_button: true })} />);
    expect(screen.getByRole('button', SEARCH_BUTTON)).toBeInTheDocument();
  });

  it('is left out when search_button is false', () => {
    render(<Host field={buildPartField({ search_button: false })} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('button', SEARCH_BUTTON)).toBeNull();
  });

  it('opens the picker when it is clicked', async () => {
    const user = userEvent.setup();
    render(<Host field={buildPartField()} />);
    await user.click(screen.getByRole('button', SEARCH_BUTTON));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('is not needed to open the picker: a typed query and Enter do it without the button', async () => {
    const user = userEvent.setup();
    render(<Host field={buildPartField({ search_button: false })} />);
    await user.type(screen.getByRole('combobox'), 'bra{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('leaves the clear button of a set value in place when it is left out', () => {
    render(<Host field={buildPartField({ search_button: false })} initial="P-1" />);
    expect(screen.getByRole('button', { name: 'ui.action.clear' })).toBeInTheDocument();
    expect(screen.queryByRole('button', SEARCH_BUTTON)).toBeNull();
  });
});
