// @vitest-environment jsdom
// A person who works in German opens the calendar of a Date field: the paging buttons are named in
// the person's language, from the app's texts, and not by the kit's English fallback.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import DateControl from '@/controls/DateControl';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};
const FIELD = { fieldname: 'due', fieldtype: 'Date', label: 'Due' } as FieldDefinition;

describe('DateControl names the calendar paging buttons', () => {
  it('by the app texts, and not by the English fallback of the kit', async () => {
    const user = userEvent.setup();
    render(
      <>
        <span id="due-label">Due</span>
        <DateControl
          field={FIELD}
          value="2026-09-28"
          doc={{}}
          entity="Loan"
          state={STATE}
          onChange={vi.fn()}
          controlId="due"
          labelId="due-label"
        />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Due' }));
    expect(screen.getByRole('button', { name: 'ui.datepicker.previous' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ui.datepicker.next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });
});
