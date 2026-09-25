// @vitest-environment jsdom
// Scan mode (scan_entry): a scanned code resolves to a generic `{ link, fields }`
// hit and books a COMPLETE row in one step, config-driven from `field.scan_entry`
// (match_on / quantity_field / field_map) — the control hardcodes no field names.
// A repeated scan matching `match_on` increments `quantity_field` (+1, supermarket
// semantics) instead of duplicating the row; `3*<code>` multiplies; an unknown code
// never adds a row — the second Enter hands the code to the link search instead.
// A field with no (or an incomplete) `scan_entry` config degrades to a plain add,
// never a crash, never a merge.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition, ScanResolveConfig } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return RECT;
  };
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: RECT,
            borderBoxSize: [{ inlineSize: 800, blockSize: 480 }],
            contentBoxSize: [{ inlineSize: 800, blockSize: 480 }],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

vi.mock('@/components/render/ControlRenderer', () => ({
  ControlRenderer: ({ field, value }: { field: FieldDefinition; value: unknown }) => (
    <input aria-label={`edit-${field.fieldname}`} value={String(value ?? '')} readOnly />
  ),
}));
vi.mock('@/components/render/cells', () => ({
  CellValue: ({ field, row }: { field: FieldDefinition; row: Record<string, unknown> }) => (
    <span>{String(row[field.fieldname] ?? '')}</span>
  ),
}));
vi.mock('@/controls/AddViaLinkSearch', () => ({
  AddViaLinkSearch: () => null,
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label }),
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: {} }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

const getViewMock = vi.fn();
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getView: (...args: unknown[]) => getViewMock(...args),
}));

import TableControl from '@/controls/TableControl';
import { ScanField } from '@/controls/ScanField';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

// Declarative resolve recipe: two view sections, tried in priority order.
// `secA` maps a dynamic `mode` from its row; `secB` (the fallback) sets a
// constant `mode` and surfaces a display `label` instead. Neither section
// name nor row-field name is known to ScanField itself — only this config
// names them.
const RESOLVE: ScanResolveConfig = {
  view: 'widgetResolve',
  try: [
    { section: 'secA', link: 'linkField', fields: { mode: 'modeField' } },
    { section: 'secB', link: 'linkField', set: { mode: 'unit' }, label: 'titleField' },
  ],
};

// A generic child-table: `child` (add_via_link) + `mode` are the dedup key
// (`match_on`); `qtyField` is where the scan multiplier lands; `qtyBase` is
// left to a (not-present-here) computed hook — the control never derives it.
const LINES_FIELD: FieldDefinition = {
  fieldname: 'lines',
  fieldtype: 'Table',
  label: 'Lines',
  add_via_link: 'child',
  entry_flow: { sequence: ['qtyField', 'rate'] },
  scan_entry: {
    resolve: RESOLVE,
    match_on: ['child', 'mode'],
    quantity_field: 'qtyField',
    field_map: { mode: 'mode' },
  },
  grid_columns: ['child', 'mode', 'qtyField', 'qtyBase'],
  child_fields: [
    { fieldname: 'child', fieldtype: 'Link', label: 'Child', target: 'Widget' },
    { fieldname: 'mode', fieldtype: 'Data', label: 'Mode' },
    { fieldname: 'qtyField', fieldtype: 'Float', label: 'Qty' },
    { fieldname: 'qtyBase', fieldtype: 'Float', label: 'Qty (base)' },
    { fieldname: 'rate', fieldtype: 'Currency', label: 'Rate' },
  ],
} as unknown as FieldDefinition;

// Same shape, but `scan_entry` carries no usable APPLY config (no match_on, no
// quantity_field, no field_map) — only `resolve`, which the scan input still
// needs to produce a hit at all. Proves the fallback: a plain add, never a
// crash, never a merge.
const NO_CONFIG_FIELD: FieldDefinition = {
  ...LINES_FIELD,
  scan_entry: { resolve: RESOLVE } as unknown as FieldDefinition['scan_entry'],
} as unknown as FieldDefinition;

// Same shape, but `mode` — a `field_map` target — ALSO carries a static
// `default`. `makeRow()` pre-seeds that default before the scan hit is
// applied; the scanned value must still win on add (never silently kept),
// matching the merge branch above which already treats a hit's mapped
// fields as ground truth.
const DEFAULT_COLLISION_FIELD: FieldDefinition = {
  ...LINES_FIELD,
  child_fields: [
    { fieldname: 'child', fieldtype: 'Link', label: 'Child', target: 'Widget' },
    { fieldname: 'mode', fieldtype: 'Data', label: 'Mode', default: 'fallback' },
    { fieldname: 'qtyField', fieldtype: 'Float', label: 'Qty' },
    { fieldname: 'qtyBase', fieldtype: 'Float', label: 'Qty (base)' },
    { fieldname: 'rate', fieldtype: 'Currency', label: 'Rate' },
  ],
} as unknown as FieldDefinition;

// Builds the View-engine envelope (`{ source, sections }` — see `ViewResult`)
// a resolve rule reads: `secA` carries the winning row, `secB` stays empty.
function hitResult(link: string, mode: string) {
  return { data: { sections: { secA: [{ linkField: link, modeField: mode }], secB: [] } } };
}
// Only the FALLBACK rule's section (`secB`) carries a row — proves priority:
// `secA` (tried first) is empty, so the second `try` entry wins.
function fallbackResult(link: string, title: string) {
  return { data: { sections: { secA: [], secB: [{ linkField: link, titleField: title }] } } };
}
// Neither section has a row — the real View engine always returns both keys,
// empty on no match, never a bare `{}`.
function missResult() {
  return { data: { sections: { secA: [], secB: [] } } };
}

function Host({ field = LINES_FIELD }: { field?: FieldDefinition }) {
  const [rows, setRows] = useState<unknown>([]);
  return (
    <div>
      <TableControl
        field={field}
        value={rows}
        doc={{ docstatus: 0 }}
        row={undefined}
        parentDoc={undefined}
        entity="Widget"
        state={STATE}
        onChange={setRows}
        controlId="lines"
        labelId="lines-label"
      />
      <pre data-testid="rows-dump">{JSON.stringify(rows)}</pre>
    </div>
  );
}

async function scanOnce(user: ReturnType<typeof userEvent.setup>, code: string) {
  const input = screen.getByTestId('scan:Widget:lines') as HTMLInputElement;
  await user.clear(input);
  await user.type(input, code);
  await user.keyboard('{Enter}');
}

function rowsDump(): Array<Record<string, unknown>> {
  return JSON.parse(screen.getByTestId('rows-dump').textContent || '[]');
}

describe('scan mode (config-driven scan_entry)', () => {
  beforeEach(() => getViewMock.mockReset());

  it('adds a row from a resolved hit: link + mapped fields + quantity_field = multiplier', async () => {
    getViewMock.mockResolvedValue(hitResult('CHILD-9', 'bulk'));
    const user = userEvent.setup();
    render(<Host />);
    await scanOnce(user, '4012345678901');
    await waitFor(() => expect(rowsDump()).toHaveLength(1));
    const row = rowsDump()[0]!;
    expect(row.child).toBe('CHILD-9');
    expect(row.mode).toBe('bulk');
    expect(row.qtyField).toBe(1);
    expect(getViewMock).toHaveBeenCalledWith('widgetResolve', { code: '4012345678901' });
    // ready for the next scan: field empty, success feedback shown
    expect((screen.getByTestId('scan:Widget:lines') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('scan-feedback').textContent).toContain('1');
  });

  it('increments quantity_field on a repeated scan matching match_on (+1, no duplicate)', async () => {
    getViewMock.mockResolvedValue(hitResult('CHILD-9', 'bulk'));
    const user = userEvent.setup();
    render(<Host />);
    await scanOnce(user, '4012345678901');
    await scanOnce(user, '4012345678901');
    await waitFor(() => expect(rowsDump()[0]?.qtyField).toBe(2));
    expect(rowsDump()).toHaveLength(1);
    // the feedback shows THIS scan's multiplier (+1), not the row's new total
    expect(screen.getByTestId('scan-feedback').textContent).toContain('+1');
  });

  it('multiplies with the till prefix 3*<code>', async () => {
    getViewMock.mockResolvedValue(hitResult('CHILD-9', 'bulk'));
    const user = userEvent.setup();
    render(<Host />);
    await scanOnce(user, '3*4012345678901');
    await waitFor(() => expect(rowsDump()).toHaveLength(1));
    expect(rowsDump()[0]!.qtyField).toBe(3);
    expect(getViewMock).toHaveBeenCalledWith('widgetResolve', { code: '4012345678901' });
  });

  it('a hit resolved via the fallback rule does NOT merge with a differing prior hit — adds a second row', async () => {
    getViewMock.mockResolvedValueOnce(hitResult('CHILD-9', 'bulk'));
    const user = userEvent.setup();
    render(<Host />);
    await scanOnce(user, '4012345678901');
    await waitFor(() => expect(rowsDump()).toHaveLength(1));

    // this code's `secA` is empty — only `secB` (the fallback `try` entry) has
    // a row, proving priority/fallback works through the full TableControl path.
    getViewMock.mockResolvedValueOnce(fallbackResult('CHILD-2', 'Second widget'));
    await scanOnce(user, '4009876543210');
    await waitFor(() => expect(rowsDump()).toHaveLength(2));
    const row = rowsDump()[1]!;
    expect(row.child).toBe('CHILD-2');
    // `mode` comes from the fallback rule's `set` constant, not a mapped field
    expect(row.mode).toBe('unit');
    expect(row.qtyField).toBe(1);
    // `label` is resolved generically from the row via the rule's `label` key
    expect(screen.getByTestId('scan-feedback').textContent).toContain('Second widget');
  });

  it('unknown code: no row, alert feedback; second Enter hands the code to the link search', async () => {
    getViewMock.mockResolvedValue(missResult());
    const user = userEvent.setup();
    render(<Host />);
    await scanOnce(user, '0000000000000');
    await waitFor(() => expect(screen.getByTestId('scan-feedback')).toBeInTheDocument());
    expect(rowsDump()).toHaveLength(0);
    expect(screen.getByTestId('scan-feedback')).toHaveAttribute('role', 'alert');
    // the miss stays selected — Enter again = search fallback
    await user.keyboard('{Enter}');
    const search = screen.getByTestId('entry:Widget:lines') as HTMLInputElement;
    await waitFor(() => expect(search.value).toBe('0000000000000'));
  });

  it('a field with no scan_entry config: minimal add, no crash, never merges', async () => {
    getViewMock.mockResolvedValue(hitResult('CHILD-9', 'bulk'));
    const user = userEvent.setup();
    render(<Host field={NO_CONFIG_FIELD} />);
    await scanOnce(user, '4012345678901');
    await waitFor(() => expect(rowsDump()).toHaveLength(1));
    expect(rowsDump()[0]!.child).toBe('CHILD-9');
    // no quantity_field declared → the control never invents one
    expect(rowsDump()[0]!.qtyField).toBeUndefined();

    // a repeat of the SAME code adds a second row instead of merging — there is
    // no match_on to dedup against.
    await scanOnce(user, '4012345678901');
    await waitFor(() => expect(rowsDump()).toHaveLength(2));
  });

  it('a field_map target that also carries a static default: the SCANNED value wins on add, not the default', async () => {
    getViewMock.mockResolvedValue(hitResult('CHILD-9', 'bulk'));
    const user = userEvent.setup();
    render(<Host field={DEFAULT_COLLISION_FIELD} />);
    await scanOnce(user, '4012345678901');
    await waitFor(() => expect(rowsDump()).toHaveLength(1));
    // `mode` is BOTH a field_map target and declares `default: 'fallback'` —
    // `makeRow()` pre-seeds that default, but the scanned hit value must be
    // authoritative on add. Without the fix this stays 'fallback'.
    expect(rowsDump()[0]!.mode).toBe('bulk');
  });
});

// Direct unit coverage of ScanField's `resolve` mechanism, isolated from
// TableControl's match_on/quantity_field/field_map application — proves the
// control builds a hit from a View's `sections` GENERICALLY, per
// `scan_entry.resolve`. A view only ever returns `{ source, sections }` (see
// `ViewResult`); there is no top-level `data.link` / `data.fields` shape for
// a view to return, so a reader of that flat shape can never see a hit here.
describe('ScanField (direct): resolve builds a hit from View sections', () => {
  beforeEach(() => getViewMock.mockReset());

  async function scan(code: string) {
    const user = userEvent.setup();
    const input = screen.getByTestId('scan-under-test') as HTMLInputElement;
    await user.type(input, code);
    await user.keyboard('{Enter}');
  }

  it('the FIRST section with a row wins: link + mapped fields + set constants + label', async () => {
    getViewMock.mockResolvedValue({
      data: {
        sections: {
          secA: [{ linkField: 'W-1', modeField: 'bulk', titleField: 'Widget one' }],
          secB: [],
        },
      },
    });
    const onScan = vi.fn(() => 'added' as const);
    render(<ScanField resolve={RESOLVE} onScan={onScan} testId="scan-under-test" />);
    await scan('111');
    await waitFor(() => expect(onScan).toHaveBeenCalled());
    // secA's rule maps `mode` via `fields`; it declares no `label`, so none is set.
    expect(onScan).toHaveBeenCalledWith({ link: 'W-1', fields: { mode: 'bulk' }, label: undefined }, 1);
    expect(getViewMock).toHaveBeenCalledWith('widgetResolve', { code: '111' });
  });

  it('falls back to the SECOND rule when only its section has a row (priority)', async () => {
    getViewMock.mockResolvedValue({
      data: { sections: { secA: [], secB: [{ linkField: 'W-2', titleField: 'Widget two' }] } },
    });
    const onScan = vi.fn(() => 'added' as const);
    render(<ScanField resolve={RESOLVE} onScan={onScan} testId="scan-under-test" />);
    await scan('222');
    await waitFor(() => expect(onScan).toHaveBeenCalled());
    // secB's rule has no `fields`, only a `set` constant + a `label` lookup.
    expect(onScan).toHaveBeenCalledWith({ link: 'W-2', fields: { mode: 'unit' }, label: 'Widget two' }, 1);
  });

  it('neither section has a row: not-found feedback, onScan never called', async () => {
    getViewMock.mockResolvedValue({ data: { sections: { secA: [], secB: [] } } });
    const onScan = vi.fn(() => 'added' as const);
    render(<ScanField resolve={RESOLVE} onScan={onScan} testId="scan-under-test" />);
    await scan('333');
    await waitFor(() => expect(screen.getByTestId('scan-feedback')).toBeInTheDocument());
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByTestId('scan-feedback')).toHaveAttribute('role', 'alert');
  });

  it('an app-declared `param` name overrides the default "code" query param', async () => {
    getViewMock.mockResolvedValue({
      data: { sections: { secA: [{ linkField: 'W-3', modeField: 'x' }], secB: [] } },
    });
    const onScan = vi.fn(() => 'added' as const);
    render(<ScanField resolve={{ ...RESOLVE, param: 'scanned' }} onScan={onScan} testId="scan-under-test" />);
    await scan('444');
    await waitFor(() => expect(onScan).toHaveBeenCalled());
    expect(getViewMock).toHaveBeenCalledWith('widgetResolve', { scanned: '444' });
  });
});
