// @vitest-environment jsdom
// Button is no field type: an entity action is the button. A field that still
// declares it is drawn as an unsupported type, which the author sees, instead of
// a button that nothing can enable.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition, FieldType } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';
import type { FieldStateMap } from '@/lib/evaluate-field';
import { FormRenderer } from '@/components/render/FormRenderer';

const FIELDS = [{ fieldname: 'renew', fieldtype: 'Button', label: 'Renew' }] as unknown as FieldDefinition[];
const STATE: FieldStateMap = {
  renew: { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false },
};

describe('a field declared Button', () => {
  it('is drawn as an unsupported field type, not as a disabled button', () => {
    render(
      <MemoryRouter>
        <FormRenderer entity="Loan" fields={FIELDS} doc={{}} fieldState={STATE} errors={{}} onFieldChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Renew' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported field type Button (renew)');
  });

  it('is no field type', () => {
    // @ts-expect-error Button is not in the FieldType union.
    const button: FieldType = 'Button';
    expect(LAYOUT_FIELD_TYPES).not.toContain(button);
  });
});
