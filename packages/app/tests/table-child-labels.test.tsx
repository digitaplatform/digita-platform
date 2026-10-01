// @vitest-environment jsdom
// A Booking has a top-level `description` and two Tables, `lines` and `damage_reports`, that both
// have a column `unit`. A person who works in German sees each column under the text of
// `field.<Entity>.<table>.<field>` in the grid header, on the cards of a phone and in the row
// dialog, also where the app ships `field.<Entity>.<field>` for a field of the same name. Where the
// table has no key for the column, the key without the table still gives its text.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ActionDefinition, EntityDefinition } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';
import { localizeAction, localizeMeta } from '@/lib/localize-meta';
import type { FieldControlState } from '@/controls/types';

// ── the grid virtualizes its rows, which needs measurable layout in jsdom ──
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const ROW_RECT = { ...RECT, height: 36, bottom: 36 } as DOMRect;
const isRow = (el: Element) => el.matches('[data-ui="table-row"]');
const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return RECT;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isRow(this) ? ROW_RECT.height : RECT.height;
    },
  });
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      const rect = isRow(target) ? ROW_RECT : RECT;
      const size = [{ inlineSize: rect.width, blockSize: rect.height }];
      this.cb(
        [{ target, contentRect: rect, borderBoxSize: size, contentBoxSize: size } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight);
  globalThis.ResizeObserver = origRO;
});

vi.mock('@/components/render/ControlRenderer', () => ({
  ControlRenderer: (p: { controlId: string }) => <input id={p.controlId} />,
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: {}, locale: undefined, settings: undefined }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

import TableControl from '@/controls/TableControl';
import { RowDetailDialog } from '@/controls/RowDetailDialog';

const meta = {
  name: 'Booking',
  label: 'Booking',
  fields: [
    { fieldname: 'description', fieldtype: 'Text', label: 'Description' },
    {
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      child_fields: [
        { fieldname: 'description', fieldtype: 'Data', label: 'Line description' },
        { fieldname: 'unit', fieldtype: 'Data', label: 'Unit' },
        { fieldname: 'no_label_at_all', fieldtype: 'Data' },
      ],
    },
    {
      fieldname: 'damage_reports',
      fieldtype: 'Table',
      label: 'Damage reports',
      child_fields: [{ fieldname: 'unit', fieldtype: 'Data', label: 'Damaged unit' }],
    },
  ],
} as unknown as EntityDefinition;

const STATE: FieldControlState = {
  visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false,
};

/** The `lines` field as the record page hands it to its control: localized for the language. */
function linesField(translations: Record<string, string>) {
  useI18nStore.setState({ translations, loaded: true });
  return localizeMeta(meta, translations).fields.find((f) => f.fieldname === 'lines')!;
}

function drawTable(translations: Record<string, string>, readOnly: boolean) {
  render(
    <TableControl
      field={linesField(translations)}
      value={[{ _row_id: 'r1', description: 'x', unit: 'y' }]}
      doc={{ docstatus: 0 }}
      entity="Booking"
      state={{ ...STATE, readOnly }}
      onChange={() => {}}
      controlId="lines"
      labelId="lines-label"
    />,
  );
}

const gridHeaders = (translations: Record<string, string>) => {
  drawTable(translations, false);
  return screen.getAllByRole('columnheader').map((h) => h.textContent);
};

const cardLabels = (translations: Record<string, string>) => {
  drawTable(translations, true);
  return [...document.querySelectorAll('dt')].map((dt) => dt.textContent);
};

const rowDialogLabels = (translations: Record<string, string>) => {
  render(
    <RowDetailDialog
      open
      onClose={() => {}}
      title="Row"
      fields={linesField(translations).child_fields!}
      stateMap={{}}
      row={{}}
      entity="Booking"
      parentDoc={{}}
      onSave={() => {}}
    />,
  );
  return [...document.querySelectorAll('label')].map((l) => l.textContent);
};

const sameNameAsTopLevel = { 'field.Booking.description': 'Beschreibung', 'field.Booking.lines.description': 'Positionstext' };
const besideTheOldKey = {
  'field.Booking.unit': 'Einheit',
  'field.Booking.lines.unit': 'Mieteinheit',
  'field.Booking.damage_reports.unit': 'Beschädigte Einheit',
};
const onlyTheOldKey = { 'field.Booking.unit': 'Einheit' };

describe.each([
  ['the grid header', gridHeaders],
  ['the cards of a phone', cardLabels],
  ['the row dialog', rowDialogLabels],
])('%s of a Table', (_surface, labels) => {
  it('shows the table key text of a child named like a top-level field', () => {
    const shown = labels(sameNameAsTopLevel);
    expect(shown).toEqual(expect.arrayContaining(['Positionstext', 'Unit']));
    expect(shown).not.toContain('Beschreibung');
  });

  it('shows the table key text where the app also ships the key without the table', () => {
    expect(labels(besideTheOldKey)).toEqual(expect.arrayContaining(['Line description', 'Mieteinheit']));
  });

  it('shows the text of the key without the table where the table has none', () => {
    expect(labels(onlyTheOldKey)).toEqual(expect.arrayContaining(['Line description', 'Einheit']));
  });

  it('words the name of a column that has neither a label nor a text', () => {
    expect(labels({})).toContain('No Label At All');
  });
});

const ACTION_TEXTS = {
  'action_field.Booking.accept.lines': 'Positionen',
  'action_field.Booking.accept.lines.unit': 'Menge je Position',
  'field.Booking.lines': 'Zeilen',
  'field.Booking.unit': 'Einheit',
};

/** The Table of an action's dialog, localized for German, drawn as the dialog draws it. */
function drawActionTable(table: Record<string, unknown>, readOnly: boolean) {
  const accept = {
    action: 'accept',
    label: 'Accept',
    dialog_fields: [
      {
        fieldname: 'lines',
        fieldtype: 'Table',
        label: 'Lines',
        child_fields: [{ fieldname: 'unit', fieldtype: 'Data', label: 'Unit' }],
        ...table,
      },
    ],
  } as unknown as ActionDefinition;
  useI18nStore.setState({ translations: ACTION_TEXTS, loaded: true });
  render(
    <TableControl
      field={localizeAction('Booking', accept, ACTION_TEXTS).dialog_fields![0]!}
      value={[{ _row_id: 'r1', unit: 'y' }]}
      doc={{ docstatus: 0 }}
      entity="Booking"
      state={{ ...STATE, readOnly }}
      onChange={() => {}}
      controlId="lines"
      labelId="lines-label"
    />,
  );
}

describe('a Table in the dialog of an action', () => {
  it('shows the action_field texts of the table and its columns over the texts of entity fields', () => {
    drawActionTable({}, true);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Menge je Position']);
    expect(screen.getByLabelText('Positionen')).toBeInTheDocument();
  });

  it.each([
    ['an editable grid', {}],
    ['a grid of line entry', { entry_flow: { sequence: ['unit'] } }],
    ['a grid that edits its rows in a dialog', { row_detail_dialog: true }],
  ])('names %s by the action_field text of the table', (_grid, table) => {
    drawActionTable(table, false);
    expect(screen.getByLabelText('Positionen')).toBeInTheDocument();
    expect(screen.queryByLabelText('Zeilen')).not.toBeInTheDocument();
  });

  it('titles the row dialog it opens by the action_field text of the table', async () => {
    drawActionTable({ row_detail_dialog: true }, false);
    fireEvent.click(screen.getByRole('button', { name: 'ui.table.editRow' }));
    expect(await screen.findByRole('dialog', { name: 'Positionen' })).toBeInTheDocument();
  });
});
