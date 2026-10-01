// @vitest-environment jsdom
// A Markdown field shows a rendered preview under its source, and a Code field edits in a
// monospace area that keeps the indentation. Both still store the text as typed.
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import { FormRenderer } from '@/components/render/FormRenderer';

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

function Form({ fieldtype, value, state, onFieldChange }: {
  fieldtype: string;
  value: unknown;
  state: FieldControlState;
  onFieldChange: (fieldname: string, value: unknown) => void;
}) {
  const field = { fieldname: 'body', fieldtype, label: 'Body' } as FieldDefinition;
  const [doc, setDoc] = useState<Record<string, unknown>>({ body: value });
  return (
    <MemoryRouter>
      <FormRenderer
        entity="ServicePackage"
        fields={[field]}
        doc={doc}
        fieldState={{ body: state }}
        errors={{}}
        onFieldChange={(fieldname, next) => {
          onFieldChange(fieldname, next);
          setDoc((previous) => ({ ...previous, [fieldname]: next }));
        }}
      />
    </MemoryRouter>
  );
}

function drawField(fieldtype: string, value?: unknown, state: Partial<FieldControlState> = {}) {
  const onFieldChange = vi.fn();
  const view = render(<Form fieldtype={fieldtype} value={value} state={{ ...OPEN, ...state }} onFieldChange={onFieldChange} />);
  return { onFieldChange, ...view };
}

const preview = () => document.querySelector('[data-ui="markdown-preview"]') as HTMLElement;

describe('the Markdown control', () => {
  it('renders the source as its preview', async () => {
    drawField('Markdown', '# Offer\n\nValid for **30 days**, *net*.\n\n- Parts\n- Labor\n\n1. First\n2. Second');
    await screen.findByLabelText('Body');
    expect(preview().querySelector('h1')).toHaveTextContent('Offer');
    expect(preview().querySelector('strong')).toHaveTextContent('30 days');
    expect(preview().querySelector('em')).toHaveTextContent('net');
    expect([...preview().querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['Parts', 'Labor']);
    expect([...preview().querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['First', 'Second']);
    expect(preview().textContent).not.toContain('**');
  });

  it('keeps the source in its text area and stores the source as typed', async () => {
    const user = userEvent.setup();
    const { onFieldChange } = drawField('Markdown', 'Hello');
    const box = await screen.findByLabelText('Body');
    expect(box).toHaveValue('Hello');
    await user.type(box, ' **world**');
    expect(onFieldChange).toHaveBeenLastCalledWith('body', 'Hello **world**');
    expect(preview().querySelector('strong')).toHaveTextContent('world');
  });

  it('renders code, quotes, links and rules', async () => {
    drawField('Markdown', 'See [the terms](https://example.com/terms) and `qr_payload`.\n\n> quoted\n\n---\n\n```\nline  one\n```');
    await screen.findByLabelText('Body');
    const link = preview().querySelector('a')!;
    expect(link).toHaveAttribute('href', 'https://example.com/terms');
    expect(link).toHaveTextContent('the terms');
    expect(preview().querySelector('p code')).toHaveTextContent('qr_payload');
    expect(preview().querySelector('blockquote')).toHaveTextContent('quoted');
    expect(preview().querySelector('hr')).not.toBeNull();
    expect(preview().querySelector('pre code')!.textContent).toBe('line  one');
  });

  it('shows raw HTML and script links in the source as text, never as markup', async () => {
    drawField('Markdown', '<img src=x onerror="alert(1)"> [click](javascript:alert(1))');
    await screen.findByLabelText('Body');
    expect(preview().querySelector('img')).toBeNull();
    expect(preview().textContent).toContain('<img src=x');
    expect(preview().querySelector('a')?.getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('keeps snake_case words as they are', async () => {
    drawField('Markdown', 'the field qr_payload_text stays');
    await screen.findByLabelText('Body');
    expect(preview().querySelector('em')).toBeNull();
    expect(preview()).toHaveTextContent('the field qr_payload_text stays');
  });
});

describe('the Code control', () => {
  it('edits in a monospace area that neither wraps nor checks spelling', async () => {
    drawField('Code', 'SPC\n0200');
    const box = await screen.findByLabelText('Body');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.className).toContain('font-mono');
    expect(box).toHaveAttribute('wrap', 'off');
    expect(box).toHaveAttribute('spellcheck', 'false');
  });

  it('starts a new line at the indentation of the line before', async () => {
    const { onFieldChange } = drawField('Code', 'if (paid) {\n    send();');
    const box = (await screen.findByLabelText('Body')) as HTMLTextAreaElement;
    box.setSelectionRange(box.value.length, box.value.length);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onFieldChange).toHaveBeenLastCalledWith('body', 'if (paid) {\n    send();\n    ');
  });

  it('leaves Enter alone on a line without indentation and in a read-only field', async () => {
    const { onFieldChange, unmount } = drawField('Code', 'plain');
    const box = (await screen.findByLabelText('Body')) as HTMLTextAreaElement;
    box.setSelectionRange(5, 5);
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(onFieldChange).not.toHaveBeenCalled();
    unmount();
    const locked = drawField('Code', '  indented', { readOnly: true });
    const lockedBox = (await screen.findByLabelText('Body')) as HTMLTextAreaElement;
    lockedBox.setSelectionRange(10, 10);
    fireEvent.keyDown(lockedBox, { key: 'Enter' });
    expect(locked.onFieldChange).not.toHaveBeenCalled();
  });
});
