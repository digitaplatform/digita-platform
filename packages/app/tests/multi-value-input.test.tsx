// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MultiValueInput } from '@/components/list/FilterEditor';

afterEach(cleanup);

describe('MultiValueInput (H17: multi-value `in` entry)', () => {
  it('keeps a just-typed trailing comma while emitting the parsed array live', () => {
    const onValue = vi.fn();
    const { getByRole } = render(
      <MultiValueInput arr={[]} numeric={false} ariaLabel="value" placeholder="p" onValue={onValue} />,
    );
    const input = getByRole('textbox') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.change(input, { target: { value: '100,' } });
    // The comma is NOT erased (the old inline `value={arr.join(', ')}` round-trip did).
    expect(input.value).toBe('100,');
    expect(onValue).toHaveBeenLastCalledWith(['100']);
    fireEvent.change(input, { target: { value: '100,200' } });
    expect(input.value).toBe('100,200');
    expect(onValue).toHaveBeenLastCalledWith(['100', '200']);
  });

  it('re-syncs the display from the external value only while unfocused', () => {
    const onValue = vi.fn();
    const { getByRole, rerender } = render(
      <MultiValueInput arr={['1', '2']} numeric={false} ariaLabel="value" placeholder="p" onValue={onValue} />,
    );
    const input = getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('1, 2'); // reflects external value when unfocused
    // While focused, an external re-render must NOT clobber the user's raw text.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '9,' } });
    rerender(
      <MultiValueInput arr={['1', '2']} numeric={false} ariaLabel="value" placeholder="p" onValue={onValue} />,
    );
    expect(input.value).toBe('9,');
  });

  it('coerces numeric list values', () => {
    const onValue = vi.fn();
    const { getByRole } = render(
      <MultiValueInput arr={[]} numeric={true} ariaLabel="value" placeholder="p" onValue={onValue} />,
    );
    fireEvent.focus(getByRole('textbox'));
    fireEvent.change(getByRole('textbox'), { target: { value: '10, 20' } });
    expect(onValue).toHaveBeenLastCalledWith([10, 20]);
  });
});
