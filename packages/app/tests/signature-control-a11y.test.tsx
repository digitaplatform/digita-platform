// @vitest-environment jsdom
// A keyboard or screen reader user keeps their place in a Signature field: Clear hands the focus to
// the pad instead of dropping it on the page, the image view carries the control id the field label
// points at and is named by that label, and each Clear says which field it clears.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (k: string) => k }));

import SignatureControl from '@/controls/SignatureControl';

const FIELD = { fieldname: 'customer_signature', fieldtype: 'Signature', label: 'Customer signature' } as FieldDefinition;
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
const DRAWN = 'data:image/png;base64,c2lnbmF0dXJl';

// jsdom has no canvas: the pad draws on a stand-in, and every encoding is the same PNG data URL.
const pen = {
  setTransform: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
};
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(pen as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(DRAWN);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The field as the record form draws it: a real label that points at the control, and the control
 *  holding what it stores. */
function Field({
  id = 'sig',
  label = 'Customer signature',
  initial,
  state = STATE,
}: {
  id?: string;
  label?: string;
  initial?: string;
  state?: FieldControlState;
}) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <div>
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <SignatureControl
        field={FIELD}
        value={value}
        doc={{}}
        entity="Quote"
        state={state}
        onChange={setValue}
        controlId={id}
        labelId={`${id}-label`}
      />
    </div>
  );
}

/** The control alone, for the cases where its value changes from outside, as a form reset does. */
function BareControl({ value }: { value: unknown }) {
  return (
    <>
      <span id="sig-label">Customer signature</span>
      <SignatureControl
        field={FIELD}
        value={value}
        doc={{}}
        entity="Quote"
        state={STATE}
        onChange={() => {}}
        controlId="sig"
        labelId="sig-label"
      />
    </>
  );
}

const pad = () => screen.getByRole('img', { name: 'Customer signature' });
const storedImage = () => screen.getByAltText('ui.signature.alt');

function drawStroke(canvas: HTMLElement) {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
}

describe('Clear keeps the focus in the Signature field', () => {
  it('hands the focus to the pad after Clear of a stored signature', async () => {
    const user = userEvent.setup();
    render(<Field initial={STORED} />);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(pad()).toHaveFocus();
  });

  it('hands the focus to the new blank pad after Clear of a drawing', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const drawn = pad();
    drawStroke(drawn);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(pad()).not.toBe(drawn);
    expect(pad()).toHaveFocus();
  });

  it('hands the focus over once: a later render leaves it where the person moved it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Field initial={STORED} />
        <button type="button">Next field</button>
      </>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    expect(pad()).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus();
    drawStroke(pad());
    expect(screen.getByRole('button', { name: 'Next field' })).toHaveFocus();
  });

  it('takes no focus when the value is emptied by something else than Clear (innocent case)', () => {
    const { rerender } = render(<BareControl value={STORED} />);
    rerender(<BareControl value={undefined} />);
    expect(pad()).not.toHaveFocus();
  });

  it('keeps the pad out of the tab order, as nothing on it works from the keyboard (innocent case)', async () => {
    const user = userEvent.setup();
    render(<Field />);
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});

describe('the image view carries the control id', () => {
  it('puts the id on the image of a stored signature, so the label points at an element', () => {
    render(<Field initial={STORED} />);
    const image = storedImage();
    const label = screen.getByText('Customer signature');
    expect(image).toHaveAttribute('id', 'sig');
    expect(document.getElementById(label.getAttribute('for')!)).toBe(image);
  });

  it('puts the id on the image of a read-only field as well', () => {
    render(<Field initial={STORED} state={{ ...STATE, readOnly: true }} />);
    expect(storedImage()).toHaveAttribute('id', 'sig');
  });

  it('names the image of a stored signature by the field label', () => {
    render(<Field initial={STORED} />);
    expect(storedImage()).toHaveAccessibleName('Customer signature');
  });

  it('names the image of a read-only field by the field label as well', () => {
    render(<Field initial={STORED} state={{ ...STATE, readOnly: true }} />);
    expect(storedImage()).toHaveAccessibleName('Customer signature');
  });

  it('tells the images of two signature fields on one form apart', () => {
    render(
      <>
        <Field initial={STORED} />
        <Field id="drv" label="Driver signature" initial={STORED} />
      </>,
    );
    expect(screen.getAllByAltText('ui.signature.alt').map((image) => image.id)).toEqual(['sig', 'drv']);
    expect(document.getElementById('sig')).toHaveAccessibleName('Customer signature');
    expect(document.getElementById('drv')).toHaveAccessibleName('Driver signature');
  });

  it('keeps the id on the pad, and on one element only (innocent case)', () => {
    render(<Field />);
    expect(pad()).toHaveAttribute('id', 'sig');
    expect(document.querySelectorAll('#sig')).toHaveLength(1);
  });
});

describe('Clear names the field it clears', () => {
  it('says which field in the image view', () => {
    render(<Field initial={STORED} />);
    expect(screen.getByRole('button', { name: 'ui.action.clear Customer signature' })).toBeInTheDocument();
  });

  it('says which field beside the pad', () => {
    render(<Field />);
    drawStroke(pad());
    expect(screen.getByRole('button', { name: 'ui.action.clear Customer signature' })).toBeInTheDocument();
  });

  it('tells two signature fields on one form apart, each Clear with an id of its own', () => {
    render(
      <>
        <Field initial={STORED} />
        <Field id="drv" label="Driver signature" initial={STORED} />
      </>,
    );
    const customer = screen.getByRole('button', { name: 'ui.action.clear Customer signature' });
    const driver = screen.getByRole('button', { name: 'ui.action.clear Driver signature' });
    expect(customer.id).not.toBe('');
    expect(customer.id).not.toBe(driver.id);
    expect(document.querySelectorAll(`[id="${customer.id}"]`)).toHaveLength(1);
    expect(document.querySelectorAll(`[id="${driver.id}"]`)).toHaveLength(1);
  });

  it('still clears: the button empties the field (innocent case)', async () => {
    const user = userEvent.setup();
    render(<Field initial={STORED} />);
    await user.click(screen.getByRole('button'));
    expect(screen.queryByAltText('ui.signature.alt')).toBeNull();
    expect(pad()).toBeInTheDocument();
  });
});
