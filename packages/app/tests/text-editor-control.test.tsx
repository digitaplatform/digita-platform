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
    typeHtml(box, '<p>pasted<a href="javascript:alert(3)" onclick="alert(4)">x</a></p>');
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', '<p>pasted<a>x</a></p>');
  });

  it('draws no overlay, form or outside image that a writer of the field planted', async () => {
    const { onFieldChange } = drawField(
      '<p class="fixed inset-0">terms</p>' +
        '<a href="https://evil.example/login" style="position:fixed;inset:0;z-index:99999" data-ui="dialog">Session expired</a>' +
        '<form action="https://evil.example/steal"><input type="password"><button>Sign in</button></form>' +
        '<img src="https://evil.example/beacon.png">',
      { readOnly: true },
    );
    const box = await screen.findByLabelText('Terms');
    const link = box.querySelector('a')!;
    expect(link).toHaveAttribute('href', 'https://evil.example/login');
    expect(link).not.toHaveAttribute('style');
    expect(link).not.toHaveAttribute('data-ui');
    expect(box.querySelector('p')).not.toHaveAttribute('class');
    expect(box.querySelector('form, input, button, img')).toBeNull();
    expect(box).toHaveTextContent('terms');
    typeHtml(box, '<p style="color:red" class="fixed">pasted</p><img src="https://evil.example/beacon.png">');
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', '<p>pasted</p>');
  });

  it('keeps the formatting a person writes: blocks, lists, emphasis and links', async () => {
    const html =
      '<h2>Terms</h2><p>a <b>b</b> <strong>c</strong> <i>d</i> <em>e</em> <u>f</u> <s>g</s> <code>h</code></p>' +
      '<div>line</div><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><pre>p</pre><hr>' +
      '<p><a href="https://example.com/terms">read</a><br><span>s</span></p>';
    const { onFieldChange } = drawField(html);
    const box = await screen.findByLabelText('Terms');
    expect(box.innerHTML).toBe(html);
    typeHtml(box, html);
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', html);
  });

  it('keeps only formatting: no form control, frame or style of a stored or pasted value', async () => {
    const planted = '<p style="position:fixed">terms</p><form action="/x"><input name="a"><button>Save</button></form><iframe src="/x"></iframe>';
    const { onFieldChange } = drawField(planted);
    const box = await screen.findByLabelText('Terms');
    expect(box.querySelector('input, button, form, iframe, [style]')).toBeNull();
    expect(box).toHaveTextContent('terms');
    typeHtml(box, planted);
    expect(onFieldChange).toHaveBeenLastCalledWith('terms', '<p>terms</p>Save');
  });

  it('keeps the content it emitted while the person types, so the caret stays', async () => {
    drawField('<p>a</p>');
    const box = await screen.findByLabelText('Terms');
    box.innerHTML = '<p>a <i>new</i></p>';
    const typed = box.querySelector('i');
    fireEvent.input(box);
    // The form handed the emitted value back; the node the person typed is still there.
    expect(box.querySelector('i')).toBe(typed);
  });

  it('refuses editing while it is read-only, and can still be reached by keyboard', async () => {
    drawField('<p>locked</p>', { readOnly: true });
    const box = await screen.findByLabelText('Terms');
    expect(box).toHaveAttribute('contenteditable', 'false');
    expect(box).toHaveAttribute('aria-readonly', 'true');
    expect(box).toHaveAttribute('tabindex', '0');
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
