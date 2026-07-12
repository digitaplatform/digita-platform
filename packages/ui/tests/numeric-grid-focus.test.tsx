// @vitest-environment jsdom
// Regression: Nordstern F1 added select-on-focus to the numeric controls, which
// is DESIRED on a record form but data-corrupting in a DataGrid cell — the grid
// seeds the first typed char as the cell value THEN mounts+focuses the editor, so
// a select() highlights that seeded char and the SECOND keystroke replaces it
// ("123"→"23"). TableControl.renderEditor now passes inGrid, and the controls must
// suppress select-on-focus when it is set. The green unit/component suites never
// caught this because it needs the seeded-char + real-onFocus combination.
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ComponentType } from 'react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps, FieldControlState } from '@/controls/types';
import CurrencyControl from '@/controls/CurrencyControl';
import FloatControl from '@/controls/FloatControl';
import IntControl from '@/controls/IntControl';
import PercentControl from '@/controls/PercentControl';
import DurationControl from '@/controls/DurationControl';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

function baseProps(overrides: Partial<FieldControlProps>): FieldControlProps {
  return {
    field: { fieldname: 'qty', fieldtype: 'Int', label: 'Qty' } as FieldDefinition,
    value: 1, // a seeded first char, as the grid would have set it
    doc: {},
    entity: 'Widget',
    state: STATE,
    onChange: () => {},
    controlId: 'c-qty',
    labelId: 'l-qty',
    ...overrides,
  };
}

const CONTROLS: Array<[string, ComponentType<FieldControlProps>]> = [
  ['CurrencyControl', CurrencyControl],
  ['FloatControl', FloatControl],
  ['IntControl', IntControl],
  ['PercentControl', PercentControl],
  ['DurationControl', DurationControl],
];

describe('numeric controls: select-on-focus is grid-aware', () => {
  for (const [name, Control] of CONTROLS) {
    it(`${name} does NOT select-on-focus when inGrid (preserves the seeded first char)`, () => {
      const { container } = render(<Control {...baseProps({ inGrid: true })} />);
      const input = container.querySelector('input') as HTMLInputElement;
      let selected = false;
      input.select = () => {
        selected = true;
      };
      fireEvent.focus(input);
      expect(selected).toBe(false);
    });

    it(`${name} DOES select-on-focus in a record form (inGrid undefined) — Nordstern F1 intact`, () => {
      const { container } = render(<Control {...baseProps({})} />);
      const input = container.querySelector('input') as HTMLInputElement;
      let selected = false;
      input.select = () => {
        selected = true;
      };
      fireEvent.focus(input);
      expect(selected).toBe(true);
    });
  }
});
