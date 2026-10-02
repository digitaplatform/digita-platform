// @vitest-environment jsdom
// A Link picker names the field a person fills, in their language, never the code name of the entity
// it points to: the group picker of the Customer form reads "Search Customer group…" and
// "Kundengruppe suchen…", not "Search CustomerGroup…". The texts are the real ones of
// TRANSLATIONS_DIR; the label stands as the meta localizer hands it to the control.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SUPPORTED_LANGUAGES, type EntityDefinition, type FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: () => ({ data: [], isLoading: false, isPlaceholderData: false }),
}));
vi.mock('@/hooks/useList', () => ({
  useList: () => ({ data: { rows: [] }, isLoading: false, isPlaceholderData: false }),
}));
// The target is a tree or a flat list as a test sets it: the mode of the picker follows its meta.
const target = vi.hoisted(() => ({ isTree: false }));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({
    data: {
      name: 'CustomerGroup',
      title_field: 'name',
      search_fields: ['name'],
      fields: [{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }],
      ...(target.isTree ? { tree: {} } : {}),
    },
  }),
}));

import LinkControl from '@/controls/LinkControl';
import { AddViaLinkSearch } from '@/controls/AddViaLinkSearch';
import { LinkEntryInput } from '@/controls/LinkEntryInput';
import { FilterEditor } from '@/components/list/FilterEditor';
import { ListToolbar } from '@/components/list/ListToolbar';
import { useI18nStore } from '@/stores/i18n';

const CODE_NAME = 'CustomerGroup';
/** The field's label in each language, as the meta localizer hands it over. */
const LABEL: Record<string, string> = {
  en: 'Customer group',
  de: 'Kundengruppe',
  es: 'Grupo de clientes',
  fr: 'Groupe de clients',
  it: 'Gruppo clienti',
  tr: 'Müşteri grubu',
};
const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

function buildGroupField(language: string, extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return { fieldname: 'group', fieldtype: 'Link', label: LABEL[language]!, target: CODE_NAME, ...extra } as FieldDefinition;
}

/** The Customer list with its group field as a quick filter, labelled as the meta localizer hands it over. */
function buildCustomerMeta(language: string): EntityDefinition {
  return { name: 'Customer', fields: [buildGroupField(language, { in_standard_filter: true })] } as EntityDefinition;
}

function renderListToolbar(meta: EntityDefinition) {
  const ignore = () => {};
  return render(
    <ListToolbar
      entity="Customer"
      meta={meta}
      search=""
      filters={[]}
      orFilters={[]}
      columns={[]}
      savedViews={[]}
      canCreate={false}
      canEditView={() => false}
      onSearch={ignore}
      onFiltersChange={ignore}
      onColumnsChange={ignore}
      onApplyView={ignore}
      onResetView={ignore}
      onAllRecords={ignore}
      onSaveView={ignore}
      onUpdateView={ignore}
      onDeleteView={ignore}
      onSetDefaultView={ignore}
      onClearDefaultView={ignore}
      onSetOrgDefaultView={ignore}
      onClearOrgDefaultView={ignore}
      onCreate={ignore}
    />,
  );
}

function renderField(field: FieldDefinition) {
  return render(
    <LinkControl
      field={field}
      value={null}
      doc={{}}
      entity="Customer"
      state={STATE}
      onChange={() => {}}
      controlId="group"
      labelId="group-label"
    />,
  );
}

const readPlaceholder = () => screen.getByRole('combobox').getAttribute('placeholder') ?? '';
const readDialogTitle = () => within(screen.getByRole('dialog')).getByRole('heading').textContent ?? '';

beforeEach(() => {
  target.isTree = false;
});
afterEach(() => {
  useI18nStore.setState({ locale: 'en' });
});

describe.each(SUPPORTED_LANGUAGES)('a Link picker in %s', (language) => {
  beforeEach(() => {
    useI18nStore.setState({ locale: language });
  });

  it('names its field by the label in its placeholder, in the tree mode', () => {
    target.isTree = true;
    renderField(buildGroupField(language));
    expect(readPlaceholder()).toContain(LABEL[language]);
    expect(readPlaceholder()).not.toContain(CODE_NAME);
  });

  it('names its field by the label in the title of the tree dialog', async () => {
    target.isTree = true;
    renderField(buildGroupField(language));
    await userEvent.setup().click(screen.getByRole('combobox'));
    expect(readDialogTitle()).toContain(LABEL[language]);
    expect(readDialogTitle()).not.toContain(CODE_NAME);
  });

  it('names its field by the label in the placeholder and the title of the search dialog', async () => {
    renderField(buildGroupField(language, { search_dialog: true }));
    expect(readPlaceholder()).toContain(LABEL[language]);
    expect(readPlaceholder()).not.toContain(CODE_NAME);
    await userEvent.setup().type(screen.getByRole('combobox'), 'a{Enter}');
    expect(readDialogTitle()).toContain(LABEL[language]);
    expect(readDialogTitle()).not.toContain(CODE_NAME);
  });

  it('names its field by the label in the placeholder of the inline search', () => {
    renderField(buildGroupField(language));
    expect(readPlaceholder()).toContain(LABEL[language]);
    expect(readPlaceholder()).not.toContain(CODE_NAME);
  });

  it('names the link field of a table by its label in the title of the add-via-link picker', () => {
    render(<AddViaLinkSearch open onClose={() => {}} linkField={buildGroupField(language)} onPick={() => {}} />);
    expect(readDialogTitle()).toContain(LABEL[language]);
    expect(readDialogTitle()).not.toContain(CODE_NAME);
  });

  it('names the link field of a table by its label in the entry input under its lines', () => {
    render(<LinkEntryInput linkField={buildGroupField(language)} onPick={() => {}} />);
    const entry = screen.getByRole('textbox');
    for (const text of [entry.getAttribute('placeholder'), entry.getAttribute('aria-label')]) {
      expect(text).toContain(LABEL[language]);
      expect(text).not.toContain(CODE_NAME);
    }
  });

  it('names its field by the label in the placeholder of the Link value of a filter row', () => {
    render(
      <FilterEditor meta={buildCustomerMeta(language)} filter={['group', '=', '']} onChange={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByPlaceholderText(LABEL[language]!, { exact: false })).toHaveAttribute('role', 'combobox');
    expect(screen.queryByPlaceholderText(CODE_NAME, { exact: false })).toBeNull();
  });

  it('names its field by the label in the placeholder of its quick filter', () => {
    renderListToolbar(buildCustomerMeta(language));
    expect(screen.getByPlaceholderText(LABEL[language]!, { exact: false })).toHaveAccessibleName(LABEL[language]);
    expect(screen.queryByPlaceholderText(CODE_NAME, { exact: false })).toBeNull();
  });
});

describe("a Link field's own placeholder", () => {
  it.each([
    ['inline', false, {}],
    ['search dialog', false, { search_dialog: true }],
    ['tree', true, {}],
  ] as const)('still wins over the picker text in the %s mode', (_mode, isTree, extra) => {
    target.isTree = isTree;
    renderField(buildGroupField('en', { ...extra, placeholder: 'Pick the group that sets the prices' }));
    expect(readPlaceholder()).toBe('Pick the group that sets the prices');
  });
});
