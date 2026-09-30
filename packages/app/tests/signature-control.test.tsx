// @vitest-environment jsdom
// A Signature is stored as a PNG data URL. An editable field is a pad a person signs on with a
// finger, a pen or the mouse: the end of each stroke stores the drawing, and Clear empties the
// field. A stored signature shows as its image, and a read-only field offers no pad at all. The
// same control serves the record form and an action's dialog, which sends it as the action's payload.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import type { ActionDefinition, EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps, FieldControlState } from '@/controls/types';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

const FIELD = { fieldname: 'customer_signature', fieldtype: 'Signature', label: 'Customer signature' } as FieldDefinition;
const ACCEPT = {
  action: 'acceptQuote',
  label: 'Accept',
  opens_dialog: true,
  dialog_fields: [FIELD],
} as unknown as ActionDefinition;
const mutateAsync = vi.fn();
vi.mock('@/hooks/useActions', () => ({
  useActions: () => ({ data: [ACCEPT] }),
  useRunAction: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/components/overlay/DialogHost', () => ({
  useDialogHost: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

import SignatureControl from '@/controls/SignatureControl';
import { ActionBar } from '@/components/workflow/ActionBar';
import { stripForSave } from '@/pages/RecordPage';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};
const STORED = 'data:image/png;base64,c3RvcmVk';
const drawnImage = (n: number) => `data:image/png;base64,c2lnbmF0dXJl${n}`;

// jsdom has no canvas: the pad draws on a stand-in that records the calls, and each encoding is a
// numbered PNG data URL, so a test can tell the strokes' images apart.
const pen = {
  setTransform: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
};
let encoded = 0;
const toDataURL = vi.fn(() => drawnImage(++encoded));
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};

beforeEach(() => {
  encoded = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(pen as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.devicePixelRatio = 1;
});

function Signature(props: Partial<FieldControlProps>) {
  return (
    <>
      <span id="sig-label">Customer signature</span>
      <SignatureControl
        field={FIELD}
        value={undefined}
        doc={{}}
        entity="Quote"
        state={STATE}
        onChange={() => {}}
        controlId="sig"
        labelId="sig-label"
        {...props}
      />
    </>
  );
}

/** Holds what the control stores, as the record form, the action dialog and a row dialog do. */
function Form({ initial, onChange }: { initial?: string; onChange: (next: unknown) => void }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <Signature
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

const pad = () => screen.getByRole('img', { name: 'Customer signature' });
const queryPad = () => screen.queryByRole('img', { name: 'Customer signature' });
const clearButton = () => screen.queryByRole('button', { name: 'ui.action.clear' });

function drawStroke(canvas: HTMLElement, pointerId = 1) {
  fireEvent.pointerDown(canvas, { pointerId, button: 0, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(canvas, { pointerId, clientX: 60, clientY: 40 });
  fireEvent.pointerUp(canvas, { pointerId, clientX: 60, clientY: 40 });
}

describe('SignatureControl on an editable field', () => {
  it('stores the drawing as a PNG data URL at the end of each stroke, on the same pad', () => {
    const onChange = vi.fn();
    render(<Form onChange={onChange} />);
    const canvas = pad();

    drawStroke(canvas);
    expect(pen.lineTo).toHaveBeenCalled();
    expect(toDataURL).toHaveBeenLastCalledWith('image/png');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(drawnImage(1));

    // The stored value is the pad's own drawing, so the pad stays for the next stroke.
    expect(pad()).toBe(canvas);
    drawStroke(canvas);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(drawnImage(2));
  });

  it('stores nothing while a pointer only passes over the pad, or presses another button', () => {
    const onChange = vi.fn();
    render(<Form onChange={onChange} />);
    const canvas = pad();

    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 2, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 40 });

    expect(pen.lineTo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows the finger that started the stroke, not a second one on the pad', () => {
    const onChange = vi.fn();
    render(<Form onChange={onChange} />);
    const canvas = pad();

    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 60, clientY: 40 });
    expect(pen.lineTo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 20 });
    expect(onChange).toHaveBeenLastCalledWith(drawnImage(1));
  });

  it('clears the drawing to a blank pad, which the record form saves as null', () => {
    const onChange = vi.fn();
    render(<Form onChange={onChange} />);
    expect(clearButton()).toBeNull();
    const canvas = pad();
    drawStroke(canvas);

    fireEvent.click(clearButton()!);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(pad()).not.toBe(canvas);
    expect(clearButton()).toBeNull();

    const meta = { name: 'Quote', fields: [FIELD] } as unknown as EntityDefinition;
    expect(stripForSave(meta, { customer_signature: undefined }, { customer_signature: drawnImage(1) })).toEqual({
      customer_signature: null,
    });
  });

  it('shows a stored signature as its image, and Clear gives the pad to sign again', () => {
    const onChange = vi.fn();
    render(<Form initial={STORED} onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', STORED);
    expect(queryPad()).toBeNull();

    fireEvent.click(clearButton()!);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByRole('img', { name: 'ui.signature.alt' })).toBeNull();
    drawStroke(pad());
    expect(onChange).toHaveBeenLastCalledWith(drawnImage(1));
  });

  it('gives up its strokes for a value it did not draw: a form reset, a reloaded record', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Signature onChange={onChange} />);
    const canvas = pad();
    drawStroke(canvas);
    rerender(<Signature value={drawnImage(1)} onChange={onChange} />);
    expect(pad()).toBe(canvas);

    rerender(<Signature value={undefined} onChange={onChange} />);
    expect(pad()).not.toBe(canvas);
    expect(clearButton()).toBeNull();

    rerender(<Signature value={STORED} onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', STORED);
    expect(queryPad()).toBeNull();
  });

  it('shows its drawing as the image once it turned read-only and editable again', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Signature onChange={onChange} />);
    drawStroke(pad());
    rerender(<Signature value={drawnImage(1)} onChange={onChange} />);

    rerender(<Signature value={drawnImage(1)} state={{ ...STATE, readOnly: true }} onChange={onChange} />);
    expect(queryPad()).toBeNull();
    rerender(<Signature value={drawnImage(1)} onChange={onChange} />);
    expect(screen.getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', drawnImage(1));
    expect(queryPad()).toBeNull();
    expect(clearButton()).not.toBeNull();
  });

  it('keeps a fixed pad, scaled by the device pixel ratio up to 2', () => {
    const sizes = [1, 2, 3].map((ratio) => {
      window.devicePixelRatio = ratio;
      const { unmount } = render(<Signature />);
      const canvas = pad() as HTMLCanvasElement;
      const size = [canvas.width, canvas.height];
      unmount();
      return size;
    });
    expect(sizes).toEqual([
      [400, 160],
      [800, 320],
      [800, 320],
    ]);
  });

  it('is labelled by the field label, described by its hint, description and error, and carries touch-none', () => {
    render(<Signature state={{ ...STATE, invalid: true }} describedById="sig-desc" errorId="sig-error" />);
    const canvas = pad();
    expect(canvas).toHaveAttribute('aria-describedby', 'sig-hint sig-desc sig-error');
    expect(canvas).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById('sig-hint')).toHaveTextContent('ui.signature.hint');
    expect(canvas).toHaveClass('touch-none');
  });
});

describe('SignatureControl on a read-only field', () => {
  const readOnly = { ...STATE, readOnly: true };

  it('shows the stored image and offers no pad and no Clear', () => {
    render(<Signature value={STORED} state={readOnly} />);
    expect(screen.getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', STORED);
    expect(queryPad()).toBeNull();
    expect(clearButton()).toBeNull();
  });

  it('says there is no signature when none is stored', () => {
    render(<Signature state={readOnly} />);
    expect(screen.getByText('ui.signature.empty')).toBeInTheDocument();
    expect(queryPad()).toBeNull();
    expect(clearButton()).toBeNull();
  });
});

describe('an action dialog with a Signature field', () => {
  it('sends the drawn signature in the action payload', async () => {
    mutateAsync.mockResolvedValue({ result: null, dialog_data: {} });
    render(
      <MemoryRouter>
        <ActionBar entity="Quote" name="Q-1" disabled={false} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    drawStroke(await screen.findByRole('img', { name: 'Customer signature' }));
    fireEvent.click(screen.getByRole('button', { name: 'ui.action.confirm' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      name: 'Q-1',
      action: 'acceptQuote',
      body: { customer_signature: drawnImage(1) },
    });
  });
});
