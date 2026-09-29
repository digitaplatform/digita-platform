import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../src/primitives/Input.js';
import { Select } from '../src/primitives/Select.js';
import { Button } from '../src/primitives/Button.js';
import { DatePicker } from '../src/composites/DatePicker.js';

/** One design value, `--control-h`, sizes every single-line control, so a design's
 *  idiom (44pt, 48dp) reaches them all and a control and its skeleton bar agree. */

const CONTROL_H = 'var(--control-h)';
const OPTIONS = [{ value: 'a', label: 'Alpha' }];

describe('every single-line control reads --control-h', () => {
  it('bare input', () => {
    render(<Input aria-label="name" />);
    expect(screen.getByRole('textbox').className).toContain(CONTROL_H);
  });
  it('input frame of the field mode', () => {
    const { container } = render(<Input label="Name" />);
    expect(container.querySelector('[data-ui="input-frame"]')!.className).toContain(CONTROL_H);
  });
  it('select trigger, md', () => {
    const { container } = render(<Select value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />);
    expect(container.querySelector('[data-ui="select-trigger"]')!.className).toContain(CONTROL_H);
  });
  it('date-picker trigger', () => {
    const { container } = render(<DatePicker onChange={() => {}} />);
    expect(container.querySelector('[data-ui="select-trigger"]')!.className).toContain(CONTROL_H);
  });
  it('button, md', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button').className).toContain(CONTROL_H);
  });
  it('the compact select keeps its own height (innocent case)', () => {
    const { container } = render(<Select size="sm" value="a" onChange={() => {}} options={OPTIONS} aria-label="pick" />);
    expect(container.querySelector('[data-ui="select-trigger"]')!.className).not.toContain(CONTROL_H);
  });
});
