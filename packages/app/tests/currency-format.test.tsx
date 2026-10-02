// @vitest-environment jsdom
// A money amount shows the fraction digits of its currency, or two when no currency is
// known: 440.90, never 440.9. A field's own `precision` wins over both.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps } from '@/controls/types';
import CurrencyControl from '@/controls/CurrencyControl';
import { CellValue } from '@/components/render/cells';
import { useSessionStore } from '@/stores/session';
import { formatCurrency } from '@/lib/format';

afterEach(() => {
  useSessionStore.setState({ settings: null, locale: null });
});

// Intl puts a no-break space between the symbol and the amount.
const spaced = (text: string) => text.replace(/\s/g, ' ');

describe('formatCurrency', () => {
  it('shows two fraction digits without a currency', () => {
    expect(formatCurrency(440.9, 'en', undefined)).toBe('440.90');
    expect(formatCurrency(120, 'en', undefined)).toBe('120.00');
    expect(formatCurrency(1371.9, 'en', null)).toBe('1,371.90');
  });

  it('shows the fraction digits of the currency', () => {
    expect(spaced(formatCurrency(440.9, 'en', 'CHF'))).toBe('CHF 440.90');
    expect(formatCurrency(440, 'en', 'JPY')).toBe('¥440');
  });

  it('keeps the precision of the field', () => {
    expect(formatCurrency(440.9, 'en', undefined, { precision: 3 })).toBe('440.900');
    expect(spaced(formatCurrency(440.9, 'en', 'CHF', { precision: 0 }))).toBe('CHF 441');
  });
});

describe('a Currency list and grid cell', () => {
  it('shows an amount without a currency with two fraction digits', () => {
    useSessionStore.setState({ locale: { code: 'en', format_locale: 'en' } });
    const field = { fieldname: 'rate', fieldtype: 'Currency', label: 'Rate' } as FieldDefinition;
    const { container } = render(<CellValue field={field} row={{ rate: 120 }} entity="QuoteItem" />);
    expect(container.textContent).toBe('120.00');
  });
});

function props(field: Partial<FieldDefinition>, overrides: Partial<FieldControlProps> = {}): FieldControlProps {
  return {
    field: { fieldname: 'grand_total', fieldtype: 'Currency', label: 'Grand total', ...field } as FieldDefinition,
    value: 208.7,
    doc: {},
    entity: 'Invoice',
    state: { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false },
    onChange: () => {},
    controlId: 'c-grand_total',
    labelId: 'l-grand_total',
    ...overrides,
  };
}
const readOnly = { visible: true, required: false, readOnly: true, invalid: false, isComputed: true, isFrozen: false, updating: false };
const input = (container: HTMLElement) => container.querySelector('input') as HTMLInputElement;

describe('CurrencyControl', () => {
  it('shows a read-only amount with two fraction digits', () => {
    const { container } = render(<CurrencyControl {...props({}, { state: readOnly })} />);
    expect(input(container).value).toBe('208.70');
  });

  it('shows the fraction digits of the record currency, else of the default currency', () => {
    const { container, unmount } = render(
      <CurrencyControl {...props({ currency_field: 'currency' }, { value: 440, doc: { currency: 'JPY' }, state: readOnly })} />,
    );
    expect(input(container).value).toBe('440');
    unmount();
    useSessionStore.setState({ settings: { platform_name: 'p', default_currency: 'CHF', allow_user_language: false, timezone: 'UTC' } });
    const again = render(<CurrencyControl {...props({ currency_field: 'currency' }, { value: 440, doc: {}, state: readOnly })} />);
    expect(input(again.container).value).toBe('440.00');
  });

  it('keeps the precision of the field', () => {
    const { container } = render(<CurrencyControl {...props({ precision: 3 }, { state: readOnly })} />);
    expect(input(container).value).toBe('208.700');
  });

  it('shows an editable amount with two fraction digits until it has focus', () => {
    const onChange = vi.fn();
    const { container } = render(<CurrencyControl {...props({}, { onChange })} />);
    expect(input(container).value).toBe('208.70');
    fireEvent.focus(input(container));
    fireEvent.change(input(container), { target: { value: '12.5' } });
    expect(onChange).toHaveBeenLastCalledWith(12.5);
  });

  it('keeps the typed text while the field has focus and shows the digits after', () => {
    function Host() {
      const [value, setValue] = useState<unknown>(208.7);
      return <CurrencyControl {...props({}, { value, onChange: setValue })} />;
    }
    const { container } = render(<Host />);
    fireEvent.focus(input(container));
    fireEvent.change(input(container), { target: { value: '12.5' } });
    expect(input(container).value).toBe('12.5');
    fireEvent.blur(input(container));
    expect(input(container).value).toBe('12.50');
  });

  it('shows a blank amount as an empty field', () => {
    const { container } = render(<CurrencyControl {...props({}, { value: undefined, state: readOnly })} />);
    expect(input(container).value).toBe('');
  });

  it('shows the raw number in a grid cell editor, so the seeded first key stays as typed', () => {
    const { container } = render(<CurrencyControl {...props({}, { value: 1, inGrid: true })} />);
    expect(input(container).value).toBe('1');
  });
});
