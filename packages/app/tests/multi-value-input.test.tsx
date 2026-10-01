// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { MultiValueInput } from '@/components/list/FilterEditor';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The input applies what is typed once typing pauses. */
function pause() {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

describe('MultiValueInput (H17: multi-value `in` entry)', () => {
  it('keeps a just-typed trailing comma while emitting the parsed array', () => {
    vi.useFakeTimers();
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
    pause();
    expect(input.value).toBe('100,');
    expect(onValue).toHaveBeenLastCalledWith(['100']);
    fireEvent.change(input, { target: { value: '100,200' } });
    pause();
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
    vi.useFakeTimers();
    const onValue = vi.fn();
    const { getByRole } = render(
      <MultiValueInput arr={[]} numeric={true} ariaLabel="value" placeholder="p" onValue={onValue} />,
    );
    fireEvent.focus(getByRole('textbox'));
    fireEvent.change(getByRole('textbox'), { target: { value: '10, 20' } });
    pause();
    expect(onValue).toHaveBeenLastCalledWith([10, 20]);
  });

  it('applies the typed list once typing pauses, not at every keystroke', () => {
    vi.useFakeTimers();
    const onValue = vi.fn();
    const { getByRole } = render(
      <MultiValueInput arr={[]} numeric={false} ariaLabel="value" placeholder="p" onValue={onValue} />,
    );
    const input = getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'r' } });
    fireEvent.change(input, { target: { value: 're' } });
    fireEvent.change(input, { target: { value: 'red' } });
    expect(onValue).not.toHaveBeenCalled();
    pause();
    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith(['red']);
  });

  it('takes the id a label points at', () => {
    const { getByLabelText } = render(
      <>
        <label htmlFor="tags-filter">Tags</label>
        <MultiValueInput id="tags-filter" arr={[]} numeric={false} ariaLabel="Tags" placeholder="p" onValue={vi.fn()} />
      </>,
    );
    expect(getByLabelText('Tags')).toHaveAttribute('id', 'tags-filter');
  });
});
