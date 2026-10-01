// @vitest-environment jsdom
// A Percent value ends left of its % sign: the input reserves room on the right for the
// sign, so value and sign never overlap. jsdom lays nothing out, so the test reads the
// Tailwind spacing the rendered control carries (one unit is 0.25rem).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';
import PercentControl from '@/controls/PercentControl';

/** The width of a "%" in text-sm, rounded up to whole spacing units. */
const SIGN_WIDTH = 3;

function props(overrides: Partial<FieldControlProps> = {}): FieldControlProps {
  return {
    field: { fieldname: 'parts_discount', fieldtype: 'Percent', label: 'Parts discount' } as FieldDefinition,
    value: 100,
    doc: {},
    entity: 'CustomerGroup',
    state: { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false },
    onChange: () => {},
    controlId: 'c-parts_discount',
    labelId: 'l-parts_discount',
    ...overrides,
  };
}

/** The right padding a class list gives, in spacing units: a `pr-*` wins over `px-*`. */
function rightPadding(className: string): number {
  const classes = className.split(/\s+/);
  for (const prefix of ['pr-', 'px-', 'p-']) {
    const own = classes.filter((c) => c.startsWith(prefix)).at(-1);
    if (own) return Number(own.slice(prefix.length));
  }
  return 0;
}

function rightOffset(className: string): number {
  const own = className.split(/\s+/).find((c) => c.startsWith('right-'));
  if (!own) throw new Error(`the sign has no right offset: "${className}"`);
  return Number(own.slice('right-'.length));
}

function reservedRoom(container: HTMLElement): { padding: number; signEnd: number } {
  const input = container.querySelector('input')!;
  const sign = [...container.querySelectorAll('span')].find((s) => s.textContent?.trim() === '%')!;
  return { padding: rightPadding(input.className), signEnd: rightOffset(sign.className) + SIGN_WIDTH };
}

describe('PercentControl', () => {
  it('reserves room right of the value for the % sign', () => {
    const { container } = render(<PercentControl {...props()} />);
    const { padding, signEnd } = reservedRoom(container);
    expect(padding).toBeGreaterThan(signEnd);
  });

  it('reserves the room in a grid cell editor too', () => {
    const { container } = render(<PercentControl {...props({ inGrid: true, value: 12.75 })} />);
    const { padding, signEnd } = reservedRoom(container);
    expect(padding).toBeGreaterThan(signEnd);
  });

  it('reads a class list as the browser would', () => {
    expect(rightPadding('px-3 py-2.5')).toBe(3);
    expect(rightPadding('px-3 py-2.5 pr-8')).toBe(8);
  });
});
