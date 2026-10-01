// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import DateControl from '@/controls/DateControl';
import { stripForSave } from '@/pages/RecordPage';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};
const FIELD = { fieldname: 'due', fieldtype: 'Date', label: 'Due', placeholder: 'Due' } as FieldDefinition;

describe('DateControl clears a set date', () => {
  it('emits an empty value and commits, and the record form saves null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <>
        <span id="due-label">Due</span>
        <DateControl
          field={FIELD}
          value="2026-09-28"
          doc={{}}
          entity="Loan"
          state={STATE}
          onChange={onChange}
          onCommit={onCommit}
          controlId="due"
          labelId="due-label"
        />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Due' }));
    await user.click(screen.getByRole('button', { name: 'ui.action.clear' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(onCommit).toHaveBeenCalled();

    const meta = { name: 'Loan', fields: [FIELD] } as unknown as EntityDefinition;
    const cleared = onChange.mock.calls[0]![0];
    expect(stripForSave(meta, { due: cleared }, { due: '2026-09-28' })).toEqual({ due: null });
  });

  it('sends a defaulted Date cleared on a new record and on a new row as null, so the engine keeps it empty (#227)', () => {
    const meta = {
      name: 'Loan',
      fields: [
        { ...FIELD, default: '__today__' },
        { fieldname: 'note', fieldtype: 'Data', label: 'Note', default: 'eval:doc.due' },
        {
          fieldname: 'lines',
          fieldtype: 'Table',
          label: 'Lines',
          child_fields: [
            { fieldname: 'product', fieldtype: 'Data', label: 'Product' },
            { fieldname: 'line_date', fieldtype: 'Date', label: 'Line Date', default: '__today__' },
          ],
        },
      ],
    } as unknown as EntityDefinition;

    expect(
      stripForSave(meta, { due: undefined, note: undefined, lines: [{ _row_id: 'n1', product: 'P', line_date: undefined }] }),
    ).toEqual({ due: null, note: undefined, lines: [{ _row_id: 'n1', product: 'P', line_date: null }] });

    // On an existing record only the row the stored record does not hold is new.
    const stored = { due: null, lines: [{ _row_id: 's1', product: 'P' }] };
    expect(
      stripForSave(meta, { due: undefined, lines: [{ _row_id: 's1', product: 'P' }, { _row_id: 'n2', line_date: undefined }] }, stored),
    ).toEqual({ due: undefined, lines: [{ _row_id: 's1', product: 'P' }, { _row_id: 'n2', line_date: null }] });
  });
});
