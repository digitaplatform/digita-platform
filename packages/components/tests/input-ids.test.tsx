import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../src/primitives/Input.js';

/** A screen or a plugin renders the field mode without an id or a name. The label and the
 *  error text still have to bind to their own input, or a screen reader reads another
 *  field's error. */

const idsOf = (...elements: Element[]) => elements.map((el) => el.id);

describe('Input field mode without an id or a name', () => {
  it('gives each labelled input its own id, and binds each label to its input', () => {
    render(
      <>
        <Input label="First name" />
        <Input label="Last name" />
      </>,
    );
    const first = screen.getByLabelText('First name');
    const last = screen.getByLabelText('Last name');
    expect(first).not.toBe(last);
    expect(first.id).not.toBe('');
    expect(first.id).not.toBe(last.id);
    expect(screen.getByText('First name')).toHaveAttribute('for', first.id);
    expect(screen.getByText('Last name')).toHaveAttribute('for', last.id);
  });

  it('points each input at its own error text', () => {
    render(
      <>
        <Input label="First name" errorMessage="Enter a first name" />
        <Input label="Last name" errorMessage="Enter a last name" />
      </>,
    );
    const [first, last] = screen.getAllByRole('textbox') as [HTMLInputElement, HTMLInputElement];
    const [firstError, lastError] = screen.getAllByRole('alert') as [HTMLElement, HTMLElement];
    expect(first).toHaveAccessibleDescription('Enter a first name');
    expect(last).toHaveAccessibleDescription('Enter a last name');
    expect(firstError.id).not.toBe(lastError.id);
    // An id built from a missing id would read `undefined-error`.
    for (const id of idsOf(first, last, firstError, lastError)) expect(id).not.toContain('undefined');
    expect(new Set(idsOf(first, last, firstError, lastError)).size).toBe(4);
  });

  it('gives a framed input with only an error text an id that its error text names', () => {
    render(<Input errorMessage="Required" aria-label="Amount" />);
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input.id).not.toBe('');
    expect(input).toHaveAccessibleDescription('Required');
  });

  it('keeps the id the caller gave, and the name when there is no id (innocent cases)', () => {
    render(
      <>
        <Input label="Given id" id="given" errorMessage="Bad id" />
        <Input label="Given name" name="given-name" errorMessage="Bad name" />
      </>,
    );
    const byId = screen.getByLabelText('Given id');
    const byName = screen.getByLabelText('Given name');
    expect(byId).toHaveAttribute('id', 'given');
    expect(byId).toHaveAttribute('aria-describedby', 'given-error');
    expect(byName).toHaveAttribute('id', 'given-name');
    expect(byName).toHaveAttribute('aria-describedby', 'given-name-error');
  });

  it('leaves the bare input without an id of its own (innocent case)', () => {
    render(<Input aria-label="Search" />);
    expect(screen.getByRole('textbox', { name: 'Search' })).not.toHaveAttribute('id');
  });
});
