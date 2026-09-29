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
});
