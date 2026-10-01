// @vitest-environment jsdom
// Heading and HTML are layout fields: the form draws them itself instead of a control. A Heading
// reads in the session language, which the localized meta every form is given carries. The markup of an HTML field comes from entity metadata that any app
// author writes, so it must reach the page only after DOMPurify has dropped what runs code.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';
import { FormRenderer } from '@/components/render/FormRenderer';
import { useI18nStore } from '@/stores/i18n';
import { localizeMeta } from '@/lib/localize-meta';

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

function drawFields(fields: Array<Record<string, unknown>>) {
  const meta = { name: 'Gadget', label: 'Gadget', fields } as unknown as EntityDefinition;
  const defined = localizeMeta(meta, useI18nStore.getState().translations).fields;
  return render(
    <MemoryRouter>
      <FormRenderer
        entity="Gadget"
        fields={defined}
        doc={{}}
        fieldState={Object.fromEntries(defined.map((field) => [field.fieldname, OPEN]))}
        errors={{}}
        onFieldChange={() => {}}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  useI18nStore.setState({ translations: {} });
});

describe('Heading', () => {
  const intro = { fieldname: 'intro', fieldtype: 'Heading', label: 'Introduction' };

  it('draws the translated label as a heading', async () => {
    useI18nStore.setState({ translations: { 'field.Gadget.intro': 'Einleitung' } });
    drawFields([intro]);
    expect(await screen.findByRole('heading', { level: 4, name: 'Einleitung' })).toBeInTheDocument();
    expect(screen.queryByText('Introduction')).toBeNull();
  });

  it('draws the label of the field where the language has no text for it', async () => {
    drawFields([intro]);
    expect(await screen.findByRole('heading', { level: 4, name: 'Introduction' })).toBeInTheDocument();
  });

  it('draws between the fields around it, without a label row of its own', async () => {
    drawFields([
      { fieldname: 'first', fieldtype: 'Data', label: 'First' },
      intro,
      { fieldname: 'last', fieldtype: 'Data', label: 'Last' },
    ]);
    const heading = await screen.findByRole('heading', { name: 'Introduction' });
    const first = await screen.findByLabelText('First');
    const last = await screen.findByLabelText('Last');
    expect(heading.closest('[data-ui="form-row"]')).toBeNull();
    expect(first.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('HTML', () => {
  it('draws the markup of its options', async () => {
    const { container } = drawFields([
      { fieldname: 'note', fieldtype: 'HTML', label: 'Note', options: '<p>Read <strong>before</strong> you start.</p><ul><li>one</li></ul>' },
    ]);
    expect(await screen.findByText('before')).toHaveProperty('tagName', 'STRONG');
    expect(container.querySelector('p')).toHaveTextContent('Read before you start.');
    expect(container.querySelectorAll('li')).toHaveLength(1);
  });

  it('draws the description when the options hold no markup', async () => {
    drawFields([{ fieldname: 'note', fieldtype: 'HTML', label: 'Note', description: '<em>Explained</em>' }]);
    expect(await screen.findByText('Explained')).toHaveProperty('tagName', 'EM');
  });

  it('drops a script element and keeps the markup around it', async () => {
    const { container } = drawFields([
      { fieldname: 'note', fieldtype: 'HTML', label: 'Note', options: '<p>Safe</p><script>window.name = "injected"</script><p>Also safe</p>' },
    ]);
    expect(await screen.findByText('Safe')).toBeInTheDocument();
    expect(screen.getByText('Also safe')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('injected');
  });

  it('drops an onerror attribute and keeps the image', async () => {
    const { container } = drawFields([
      { fieldname: 'note', fieldtype: 'HTML', label: 'Note', options: '<img src="logo.png" alt="Logo" onerror="window.name = \'injected\'">' },
    ]);
    const image = await screen.findByRole('img', { name: 'Logo' });
    expect(image).toHaveAttribute('src', 'logo.png');
    expect(image).not.toHaveAttribute('onerror');
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('drops a javascript: link target and keeps the link text', async () => {
    drawFields([{ fieldname: 'note', fieldtype: 'HTML', label: 'Note', options: '<a href="javascript:window.name = 1">Run</a>' }]);
    const text = await screen.findByText('Run');
    expect(text).not.toHaveAttribute('href');
  });

  it('keeps a link with its address and its target', async () => {
    drawFields([
      { fieldname: 'note', fieldtype: 'HTML', label: 'Note', options: '<a href="https://example.com/docs" target="_blank">Docs</a>' },
    ]);
    const link = await screen.findByRole('link', { name: 'Docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
