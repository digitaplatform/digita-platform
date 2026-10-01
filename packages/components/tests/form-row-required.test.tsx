import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormRow } from '../src/composites/FormRow.js';

/** The label of a required field names its control, and a control that adds the label to its own
 *  text (a Clear beside a signature) through aria-labelledby: the star is drawn for the eye only. */
function Row({ required }: { required: boolean }) {
  return (
    <FormRow controlId="sig" labelId="sig-label" label="Customer signature" required={required}>
      <input id="sig" />
      <button id="sig-clear" type="button" aria-labelledby="sig-clear sig-label">
        Clear
      </button>
    </FormRow>
  );
}

describe('FormRow required star', () => {
  it('stays out of the name the label gives a control that points at it', () => {
    render(<Row required />);
    expect(screen.getByRole('button', { name: 'Clear Customer signature' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Customer signature' })).toBeInTheDocument();
  });

  it('is still drawn after the label text (innocent case)', () => {
    render(<Row required />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('is not drawn on a field that is not required (innocent case)', () => {
    render(<Row required={false} />);
    expect(screen.queryByText('*')).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear Customer signature' })).toBeInTheDocument();
  });
});
