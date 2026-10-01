import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select } from '../src/primitives/Select.js';

/** A screen or a plugin renders a labelled Select without an id, as a dialog that creates a user
 *  does with its language. The label still has to name its own trigger, or a screen reader meets
 *  an unnamed combobox. */

const LANGUAGES = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
];

describe('Select with a label and without an id', () => {
  it('gives each trigger its own id, and binds each label to its trigger', () => {
    render(
      <>
        <Select label="Language" name="lang" value="de" onChange={() => {}} options={LANGUAGES} />
        <Select label="Fallback language" value="en" onChange={() => {}} options={LANGUAGES} />
      </>,
    );
    const language = screen.getByRole('combobox', { name: 'Language' });
    const fallback = screen.getByRole('combobox', { name: 'Fallback language' });
    expect(language.id).not.toBe('');
    expect(language.id).not.toBe(fallback.id);
    expect(screen.getByText('Language')).toHaveAttribute('for', language.id);
    expect(screen.getByText('Fallback language')).toHaveAttribute('for', fallback.id);
  });

  it('names a searchable trigger, a plain button, by its label as well', () => {
    render(<Select label="Language" searchable value="de" onChange={() => {}} options={LANGUAGES} />);
    expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('Deutsch');
  });

  it('keeps the id the caller gave (innocent case)', () => {
    render(<Select label="Language" id="given" value="de" onChange={() => {}} options={LANGUAGES} />);
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveAttribute('id', 'given');
  });
});
