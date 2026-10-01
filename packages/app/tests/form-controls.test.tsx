// @vitest-environment jsdom
// A record form draws each field through FormRenderer and the control of its type. Every control
// here is drawn with a value, changed the way a person changes it, and the value the form receives
// is asserted, so a change to a kit input or to the renderer that breaks one control turns its own
// test red instead of shipping green.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import { FormRenderer } from '@/components/render/FormRenderer';
import { useI18nStore } from '@/stores/i18n';
import { useSessionStore } from '@/stores/session';

vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

const OPEN: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

function buildField(fieldtype: string, extra: Record<string, unknown> = {}): FieldDefinition {
  return { fieldname: 'thing', fieldtype, label: 'Thing', ...extra } as FieldDefinition;
}

// Holds the value a person has typed so far, as a record page does: a control that emits one key at a
// time then shows the whole value, and what the form receives is what the person sees.
function Form({
  field,
  value,
  state,
  onFieldChange,
}: {
  field: FieldDefinition;
  value: unknown;
  state: FieldControlState;
  onFieldChange: (fieldname: string, value: unknown) => void;
}) {
  const [doc, setDoc] = useState<Record<string, unknown>>({ [field.fieldname]: value });
  return (
    <MemoryRouter>
      <FormRenderer
        entity="Gadget"
        fields={[field]}
        doc={doc}
        fieldState={{ [field.fieldname]: state }}
        errors={{}}
        onFieldChange={(fieldname, next) => {
          onFieldChange(fieldname, next);
          setDoc((previous) => ({ ...previous, [fieldname]: next }));
        }}
      />
    </MemoryRouter>
  );
}

function drawField(field: FieldDefinition, value?: unknown, state: Partial<FieldControlState> = {}) {
  const onFieldChange = vi.fn();
  const view = render(<Form field={field} value={value} state={{ ...OPEN, ...state }} onFieldChange={onFieldChange} />);
  return { onFieldChange, ...view };
}

afterEach(() => {
  useI18nStore.setState({ translations: {} });
  useSessionStore.setState({ locale: null });
});

describe('the multi-line text controls', () => {
  it.each(['Text', 'SmallText', 'TextEditor', 'Code', 'Markdown'])(
    '%s draws its text in a text area and emits what is typed',
    async (fieldtype) => {
      const user = userEvent.setup();
      const { onFieldChange } = drawField(buildField(fieldtype), 'first line');
      const box = await screen.findByLabelText('Thing');
      expect(box.tagName).toBe('TEXTAREA');
      expect(box).toHaveValue('first line');

      await user.type(box, ' and more');
      expect(onFieldChange).toHaveBeenLastCalledWith('thing', 'first line and more');

      await user.clear(box);
      expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);
    },
  );

  it.each(['Text', 'SmallText', 'TextEditor', 'Code', 'Markdown'])('%s refuses typing while it is read-only', async (fieldtype) => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField(fieldtype), 'locked text', { readOnly: true });
    const box = await screen.findByLabelText('Thing');
    expect(box).toHaveAttribute('readonly');
    await user.type(box, 'x');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('draws SmallText in fewer rows than Text', async () => {
    const small = drawField(buildField('SmallText'));
    const smallRows = Number((await screen.findByLabelText('Thing')).getAttribute('rows'));
    small.unmount();
    drawField(buildField('Text'));
    const textRows = Number((await screen.findByLabelText('Thing')).getAttribute('rows'));
    expect(smallRows).toBeLessThan(textRows);
  });
});

const SINGLE_LINE = [
  { fieldtype: 'Data', value: 'Ada Lovelace', inputType: 'text' },
  { fieldtype: 'Password', value: 'hunter2', inputType: 'password' },
  { fieldtype: 'Phone', value: '+41 44 123 45 67', inputType: 'tel' },
  { fieldtype: 'Barcode', value: '4012345678901', inputType: 'text' },
];

describe('the single-line text controls', () => {
  it.each(SINGLE_LINE)('$fieldtype draws its value in a $inputType input and emits what is typed', async ({ fieldtype, value, inputType }) => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField(fieldtype), value);
    const input = await screen.findByLabelText('Thing');
    expect(input).toHaveAttribute('type', inputType);
    expect(input).toHaveValue(value);

    await user.type(input, '7');
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', `${value}7`);

    await user.clear(input);
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);
  });

  it.each(SINGLE_LINE)('$fieldtype refuses typing while it is read-only', async ({ fieldtype, value }) => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField(fieldtype), value, { readOnly: true });
    const input = await screen.findByLabelText('Thing');
    expect(input).toHaveAttribute('readonly');
    await user.type(input, '7');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it.each([
    ['Email', 'email'],
    ['URL', 'url'],
  ])('hints a Data field of format %s to the browser as a %s input', async (format, inputType) => {
    drawField(buildField('Data', { options: format }), 'x');
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('type', inputType);
  });

  it('draws the placeholder of a Barcode field, and a hint of its own when the field names none', async () => {
    const named = drawField(buildField('Barcode', { placeholder: 'Scan or type' }));
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('placeholder', 'Scan or type');
    named.unmount();
    drawField(buildField('Barcode'));
    expect((await screen.findByLabelText('Thing')).getAttribute('placeholder')).toBeTruthy();
  });
});

describe('Check', () => {
  it('draws a set value as on and emits 0 when it is switched off', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Check'), 1);
    const toggle = await screen.findByRole('switch', { name: 'Thing' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', 0);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('draws an unset value as off and emits 1 when it is switched on', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Check'));
    const toggle = await screen.findByRole('switch', { name: 'Thing' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', 1);
  });

  it('reads a boolean true as on', async () => {
    drawField(buildField('Check'), true);
    expect(await screen.findByRole('switch', { name: 'Thing' })).toHaveAttribute('aria-checked', 'true');
  });

  it('refuses a click while it is read-only', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Check'), 1, { readOnly: true });
    const toggle = await screen.findByRole('switch', { name: 'Thing' });
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(onFieldChange).not.toHaveBeenCalled();
  });
});

describe('Rating', () => {
  it('draws the stars of a stored fraction and emits the fraction of the star that is clicked', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Rating'), 0.6);
    const stars = await screen.findByRole('radiogroup', { name: 'Thing' });
    expect(within(stars).getAllByText('★')).toHaveLength(3);
    expect(within(stars).getByRole('radio', { name: '3 of 5' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(stars).getByRole('radio', { name: '4 of 5' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', 0.8);
    expect(within(stars).getAllByText('★')).toHaveLength(4);
  });

  it('draws five empty stars while no rating is set', async () => {
    drawField(buildField('Rating'));
    const stars = await screen.findByRole('radiogroup', { name: 'Thing' });
    expect(within(stars).getAllByText('☆')).toHaveLength(5);
    expect(within(stars).queryByText('★')).toBeNull();
  });

  it('refuses a click while it is read-only', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Rating'), 0.2, { readOnly: true });
    const star = within(await screen.findByRole('radiogroup', { name: 'Thing' })).getByRole('radio', { name: '5 of 5' });
    expect(star).toBeDisabled();
    await user.click(star);
    expect(onFieldChange).not.toHaveBeenCalled();
  });
});

describe('Select', () => {
  const choices = ['Open', 'Closed', 'On hold'];

  it('draws the translated label of the stored choice and emits the stored value of the one picked', async () => {
    useI18nStore.setState({
      translations: { 'option.Gadget.thing.Closed': 'Geschlossen', 'option.Gadget.thing.On hold': 'Zurückgestellt' },
    });
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Select', { options: choices }), 'Closed');
    const trigger = await screen.findByRole('combobox', { name: 'Thing' });
    expect(trigger).toHaveTextContent('Geschlossen');

    await user.click(trigger);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['—', 'Open', 'Geschlossen', 'Zurückgestellt']);
    await user.click(screen.getByRole('option', { name: 'Zurückgestellt' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', 'On hold');
    expect(trigger).toHaveTextContent('Zurückgestellt');
  });

  it('reads the choices of a newline-delimited string', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Select', { options: 'Open\n Closed \n\nOn hold' }), 'Open');
    await user.click(await screen.findByRole('combobox', { name: 'Thing' }));
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['—', 'Open', 'Closed', 'On hold']);
    await user.click(screen.getByRole('option', { name: 'Closed' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', 'Closed');
  });

  it('draws a stored value that the choices no longer list', async () => {
    drawField(buildField('Select', { options: choices }), 'Retired');
    expect(await screen.findByRole('combobox', { name: 'Thing' })).toHaveTextContent('Retired');
  });

  it('clears an optional Select to null, so the clear reaches the engine', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Select', { options: choices }), 'Open');
    await user.click(await screen.findByRole('combobox', { name: 'Thing' }));
    await user.click(screen.getByRole('option', { name: '—' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', null);
  });

  it('clears a required Select to undefined, so the form reports it as missing', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Select', { options: choices }), 'Open', { required: true });
    // The required star is part of the label, and so of the name.
    await user.click(await screen.findByRole('combobox', { name: /^Thing/ }));
    await user.click(screen.getByRole('option', { name: '—' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);
  });

  it('refuses to open while it is read-only', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Select', { options: choices }), 'Open', { readOnly: true });
    const trigger = await screen.findByRole('combobox', { name: 'Thing' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onFieldChange).not.toHaveBeenCalled();
  });
});

describe('Tag', () => {
  it('draws each tag as a chip and emits the list with a trimmed new tag added on Enter', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Tag'), ['red', 'green']);
    const input = await screen.findByLabelText('Thing');
    expect(screen.getByText('red')).toBeInTheDocument();
    expect(screen.getByText('green')).toBeInTheDocument();

    await user.type(input, '  blue {Enter}');
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', ['red', 'green', 'blue']);
    expect(screen.getByText('blue')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('ignores a tag that the list already holds', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Tag'), ['red']);
    await user.type(await screen.findByLabelText('Thing'), 'red{Enter}');
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it('removes a tag, and emits undefined once none is left', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Tag'), ['red', 'green']);
    await user.click(await screen.findByRole('button', { name: 'Remove red' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', ['green']);

    await user.click(screen.getByRole('button', { name: 'Remove green' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);
  });

  it('offers no input and no remove button while it is read-only', async () => {
    drawField(buildField('Tag'), ['red'], { readOnly: true });
    expect(await screen.findByText('red')).toBeInTheDocument();
    expect(screen.queryByLabelText('Thing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove red' })).toBeNull();
  });
});

describe('Color', () => {
  it('draws the stored color in the swatch and the hex field and emits what is typed or picked', async () => {
    const user = userEvent.setup();
    const { onFieldChange, container } = drawField(buildField('Color'), '#ff8800');
    const hex = await screen.findByLabelText('Thing');
    const swatch = container.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(hex).toHaveValue('#ff8800');
    expect(swatch).toHaveValue('#ff8800');

    await user.clear(hex);
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);

    await user.type(hex, '#00aa11');
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', '#00aa11');
    expect(swatch).toHaveValue('#00aa11');

    fireEvent.change(swatch, { target: { value: '#123456' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', '#123456');
    expect(hex).toHaveValue('#123456');
  });

  it('shows black in the swatch while no color is set, and leaves the hex field empty', async () => {
    const { container } = drawField(buildField('Color'));
    expect(await screen.findByLabelText('Thing')).toHaveValue('');
    expect(container.querySelector('input[type="color"]')).toHaveValue('#000000');
  });

  it('locks the swatch and the hex field while it is read-only', async () => {
    const { container } = drawField(buildField('Color'), '#ff8800', { readOnly: true });
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('readonly');
    expect(container.querySelector('input[type="color"]')).toBeDisabled();
  });
});

describe('Geolocation', () => {
  const point = { type: 'Point', coordinates: [8.5417, 47.3769] };

  it('draws the longitude and the latitude and emits the point with the coordinate that changed', async () => {
    const { onFieldChange } = drawField(buildField('Geolocation'), point);
    await screen.findByLabelText('Thing');
    const [longitude, latitude] = screen.getAllByRole('spinbutton');
    expect(longitude).toHaveValue(8.5417);
    expect(latitude).toHaveValue(47.3769);

    fireEvent.change(longitude!, { target: { value: '9' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', { type: 'Point', coordinates: [9, 47.3769] });

    fireEvent.change(latitude!, { target: { value: '48.5' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', { type: 'Point', coordinates: [9, 48.5] });
  });

  it('draws two empty inputs while no point is set', async () => {
    drawField(buildField('Geolocation'));
    await screen.findByLabelText('Thing');
    const [longitude, latitude] = screen.getAllByRole('spinbutton');
    expect(longitude).toHaveValue(null);
    expect(latitude).toHaveValue(null);
  });

  it('refuses edits while it is read-only', async () => {
    drawField(buildField('Geolocation'), point, { readOnly: true });
    await screen.findByLabelText('Thing');
    for (const input of screen.getAllByRole('spinbutton')) expect(input).toHaveAttribute('readonly');
  });
});

describe('JSON', () => {
  it('draws the stored value as indented text and emits the parsed value when the field loses focus', async () => {
    const { onFieldChange } = drawField(buildField('JSON'), { a: 1, list: [1, 2] });
    const box = await screen.findByLabelText('Thing');
    expect(box).toHaveValue(JSON.stringify({ a: 1, list: [1, 2] }, null, 2));

    fireEvent.change(box, { target: { value: '{"a": 2}' } });
    expect(onFieldChange).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', { a: 2 });
  });

  it('keeps half-typed text that is no JSON yet and emits nothing for it', async () => {
    const { onFieldChange } = drawField(buildField('JSON'), { a: 1 });
    const box = await screen.findByLabelText('Thing');
    fireEvent.change(box, { target: { value: '{"a":' } });
    fireEvent.blur(box);
    expect(onFieldChange).not.toHaveBeenCalled();
    expect(box).toHaveValue('{"a":');
  });

  it('emits null when the text is emptied, so the clear reaches the engine', async () => {
    const { onFieldChange } = drawField(buildField('JSON'), { a: 1 });
    const box = await screen.findByLabelText('Thing');
    fireEvent.change(box, { target: { value: '  ' } });
    fireEvent.blur(box);
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', null);
  });

  it('locks the text while it is read-only', async () => {
    drawField(buildField('JSON'), { a: 1 }, { readOnly: true });
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('readonly');
  });
});

describe('Date', () => {
  it('draws the stored day in the session format and emits the day that is picked as YYYY-MM-DD', async () => {
    useSessionStore.setState({ locale: { code: 'en', format_locale: 'en-GB' } });
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Date'), '2026-09-28');
    const trigger = await screen.findByRole('button', { name: 'Thing' });
    expect(trigger).toHaveTextContent('28/09/2026');

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '15' }));
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', '2026-09-15');
    expect(trigger).toHaveTextContent('15/09/2026');
  });

  it('draws the day of a stored timestamp', async () => {
    useSessionStore.setState({ locale: { code: 'en', format_locale: 'en-GB' } });
    drawField(buildField('Date'), '2026-09-28T23:30:00.000Z');
    expect(await screen.findByRole('button', { name: 'Thing' })).toHaveTextContent('28/09/2026');
  });

  it('draws the placeholder while no day is set', async () => {
    drawField(buildField('Date', { placeholder: 'Pick a day' }));
    expect(await screen.findByRole('button', { name: 'Thing' })).toHaveTextContent('Pick a day');
  });

  it('refuses to open while it is read-only', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField(buildField('Date'), '2026-09-28', { readOnly: true });
    const trigger = await screen.findByRole('button', { name: 'Thing' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('button', { name: '15' })).toBeNull();
    expect(onFieldChange).not.toHaveBeenCalled();
  });
});

describe('Datetime', () => {
  it('draws the stored moment in the time zone of the person and emits the edited time as UTC', async () => {
    useSessionStore.setState({ locale: { code: 'en', format_locale: 'en', timezone: 'Europe/Zurich' } });
    const { onFieldChange } = drawField(buildField('Datetime'), '2026-09-28T10:30:45.000Z');
    const input = await screen.findByLabelText('Thing');
    expect(input).toHaveAttribute('type', 'datetime-local');
    expect(input).toHaveValue('2026-09-28T12:30');

    fireEvent.change(input, { target: { value: '2026-10-01T08:15' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', '2026-10-01T06:15:00.000Z');

    fireEvent.change(input, { target: { value: '' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);
  });

  it('locks the input while it is read-only', async () => {
    drawField(buildField('Datetime'), '2026-09-28T10:30', { readOnly: true });
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('readonly');
  });
});

describe('Time', () => {
  it('draws the stored time without seconds and emits the edited time', async () => {
    const { onFieldChange } = drawField(buildField('Time'), '08:30:15');
    const input = await screen.findByLabelText('Thing');
    expect(input).toHaveAttribute('type', 'time');
    expect(input).toHaveValue('08:30');

    fireEvent.change(input, { target: { value: '17:45' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', '17:45');

    fireEvent.change(input, { target: { value: '' } });
    expect(onFieldChange).toHaveBeenLastCalledWith('thing', undefined);
  });

  it('locks the input while it is read-only', async () => {
    drawField(buildField('Time'), '08:30', { readOnly: true });
    expect(await screen.findByLabelText('Thing')).toHaveAttribute('readonly');
  });
});
