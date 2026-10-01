// @vitest-environment jsdom
// A TextEditor field shows its stored HTML as formatted text and is edited without markup;
// it stores HTML, as before.
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import { FormRenderer } from '@/components/render/FormRenderer';
import { TextEditorControl } from '@/controls/TextControl';

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

function Form({ value, state, onFieldChange }: {
  value: unknown;
  state: FieldControlState;
  onFieldChange: (fieldname: string, value: unknown) => void;
}) {
  const field = { fieldname: 'terms', fieldtype: 'TextEditor', label: 'Terms' } as FieldDefinition;
  const [doc, setDoc] = useState<Record<string, unknown>>({ terms: value });
  return (
    <MemoryRouter>
      <FormRenderer
        entity="Quote"
        fields={[field]}
        doc={doc}
        fieldState={{ terms: state }}
        errors={{}}
        onFieldChange={(fieldname, next) => {
          onFieldChange(fieldname, next);
          setDoc((previous) => ({ ...previous, [fieldname]: next }));
        }}
      />
    </MemoryRouter>
  );
}

function drawField(value?: unknown, state: Partial<FieldControlState> = {}) {
  const onFieldChange = vi.fn();
  const view = render(<Form value={value} state={{ ...OPEN, ...state }} onFieldChange={onFieldChange} />);
  return { onFieldChange, ...view };
}

/** Types into the editor as a browser does: the DOM changes, then an input event fires. */
function typeHtml(box: HTMLElement, html: string) {
  box.innerHTML = html;
  fireEvent.input(box);
}

describe('the TextEditor control', () => {
  it('shows the stored HTML as formatted text, not as tags', async () => {
    drawField('<p>a <b>b</b></p>');
    const box = await screen.findByLabelText('Terms');
    expect(box.tagName).not.toBe('TEXTAREA');
    expect(box).toHaveAttribute('contenteditable', 'true');
    expect(box).toHaveAttribute('role', 'textbox');
    expect(box.querySelector('b')).toHaveTextContent('b');
    expect(box).toHaveTextContent('a b');
    expect(box.textContent).not.toContain('<p>');
  });

  it('stores what the person edits as HTML', async () => {
    const { onFieldChange } = drawField('<p>a</p>');
    const box = await screen.findByLabelText('Terms');
    typeHtml(box, '<p>a <i>new</i> line</p>');
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', '<p>a <i>new</i> line</p>');
    expect(box.querySelector('i')).toHaveTextContent('new');
  });

  it('stores an emptied editor as no value', async () => {
    const { onFieldChange } = drawField('<p>a</p>');
    const box = await screen.findByLabelText('Terms');
    typeHtml(box, '<br>');
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', undefined);
  });

  it('drops scripts and event handlers from shown and stored HTML', async () => {
    const { onFieldChange } = drawField('<p onclick="alert(1)">safe</p><script>alert(2)</script>');
    const box = await screen.findByLabelText('Terms');
    expect(box.querySelector('script')).toBeNull();
    expect(box.querySelector('p')).not.toHaveAttribute('onclick');
    typeHtml(box, '<p>pasted<img src="x" onerror="alert(3)"></p>');
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', '<p>pasted<img src="x"></p>');
  });

  it('refuses editing while it is read-only', async () => {
    drawField('<p>locked</p>', { readOnly: true });
    const box = await screen.findByLabelText('Terms');
    expect(box).toHaveAttribute('contenteditable', 'false');
    expect(box).toHaveAttribute('aria-readonly', 'true');
    expect(box).toHaveTextContent('locked');
  });

  it('shows a value that changes from outside', async () => {
    const field = { fieldname: 'terms', fieldtype: 'TextEditor', label: 'Terms' } as FieldDefinition;
    const control = (value: unknown) => (
      <TextEditorControl field={field} value={value} doc={{}} entity="Quote" state={OPEN} onChange={() => {}} controlId="c" labelId="l" />
    );
    const { container, rerender } = render(control('<p>first</p>'));
    rerender(control('<p>second</p>'));
    expect(container.querySelector('[role="textbox"]')).toHaveTextContent('second');
  });
});
