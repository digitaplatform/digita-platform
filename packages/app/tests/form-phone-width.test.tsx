// @vitest-environment jsdom
// On a phone a section of a record form fits its card: no cell is wider than the form, so no
// field, no Signature pad and no Clear button reaches past the right edge, where the page clips it.
// jsdom lays nothing out, so the test reads the grid from the classes the form renders, the way a
// browser sizes it: the tracks of `grid-cols-N` are minmax(0, 1fr) and shrink to nothing, while
// each column gap between the tracks a cell spans keeps its full width.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import resolveConfig from 'tailwindcss/resolveConfig';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldStateMap } from '@/lib/evaluate-field';
import { FormRenderer } from '@/components/render/FormRenderer';
import { RecordSkeleton } from '@/components/render/RecordSkeleton';
import type { EntityDefinition } from '@digitaplatform/shared';
import tailwindConfig from '../tailwind.config.js';

// A Link and a Table control read the engine. The grid, not the control, sizes a cell, so they
// stand in empty.
vi.mock('@/controls/LinkControl', () => ({ default: () => null }));
vi.mock('@/controls/TableControl', () => ({ default: () => null }));

const theme = resolveConfig(tailwindConfig).theme;
const breakpoints: Record<string, unknown> = theme.screens;
const gaps: Record<string, string | undefined> = theme.gap;

/** A length of the theme in CSS pixels, at the browser's default root font size. */
function pixels(length: string): number {
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(length);
  if (!match) throw new Error(`not a length in px or rem: ${length}`);
  return Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
}

/** The grid utilities of `className` that apply on a viewport `viewport` px wide, in the order
 *  their rules win: a wider breakpoint after a narrower one, and within one breakpoint `gap-x-*`
 *  after `gap-*`, as Tailwind orders its CSS. */
function gridUtilitiesAt(className: string, viewport: number): string[] {
  const applying: { from: number; order: number; utility: string }[] = [];
  for (const token of className.split(/\s+/).filter(Boolean)) {
    const variants = token.split(':');
    const utility = variants.pop()!;
    if (!/^(grid-cols-|col-span-|gap-)/.test(utility)) continue;
    if (variants.length > 1) throw new Error(`the rule reads at most one breakpoint per class: ${token}`);
    let from = 0;
    if (variants.length === 1) {
      const minWidth = breakpoints[variants[0]!];
      if (typeof minWidth !== 'string') throw new Error(`not a min-width breakpoint: ${token}`);
      from = pixels(minWidth);
    }
    if (viewport >= from) applying.push({ from, order: utility.startsWith('gap-x-') ? 1 : 0, utility });
  }
  return applying.sort((a, b) => a.from - b.from || a.order - b.order).map((entry) => entry.utility);
}

/** The tracks of a grid and the gap between them, on a viewport `viewport` px wide. */
function gridAt(gridClassName: string, viewport: number): { tracks: number; columnGap: number } {
  let tracks: number | undefined;
  let columnGap = 0;
  for (const utility of gridUtilitiesAt(gridClassName, viewport)) {
    const columns = /^grid-cols-(\d+)$/.exec(utility);
    if (columns) tracks = Number(columns[1]);
    const gap = /^gap-(?:x-)?(.+)$/.exec(utility);
    if (gap && !utility.startsWith('gap-y-')) {
      const length = gaps[gap[1]!];
      if (length === undefined) throw new Error(`not a gap of the theme: ${utility}`);
      columnGap = pixels(length);
    }
  }
  if (tracks === undefined) throw new Error(`no grid-cols-N applies at ${viewport}px: ${gridClassName}`);
  return { tracks, columnGap };
}

/** How wide a cell of a grid is in a form `formWidth` px wide on a viewport `viewport` px wide. */
function cellWidth(gridClassName: string, cellClassName: string, formWidth: number, viewport: number): number {
  const { tracks, columnGap } = gridAt(gridClassName, viewport);
  let span = 1;
  for (const utility of gridUtilitiesAt(cellClassName, viewport)) {
    const match = /^col-span-(\d+|full)$/.exec(utility);
    if (match) span = match[1] === 'full' ? tracks : Number(match[1]);
  }
  if (span > tracks) throw new Error(`a span past the tracks adds tracks the rule does not size: ${cellClassName}`);
  const track = Math.max(0, (formWidth - (tracks - 1) * columnGap) / tracks);
  return span * track + (span - 1) * columnGap;
}

/** The narrowest form of a phone `viewport` px wide: the shell pads the page by 16 px and a card in
 *  the spacious density pads the section by 32 px, on each side. */
const phoneForm = (viewport: number) => viewport - 2 * 16 - 2 * 32;
const PHONE = 360;
const PHONE_FORM = phoneForm(PHONE);

const EDITABLE = { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false };

/** Draws `fields` as the form of a WorkOrder and returns the cell of each field, in order. */
function renderCells(fields: FieldDefinition[]): HTMLElement[] {
  const fieldState: FieldStateMap = Object.fromEntries(fields.map((f) => [f.fieldname, EDITABLE]));
  render(
    <MemoryRouter>
      <FormRenderer entity="WorkOrder" fields={fields} doc={{}} fieldState={fieldState} errors={{}} onFieldChange={() => {}} />
    </MemoryRouter>,
  );
  return fields.map((f) => screen.getByTestId(`field:WorkOrder:${f.fieldname}`));
}

describe('the layout rule of a form grid', () => {
  it('finds the full row of a twelve-track grid with fixed gaps wider than a phone form', () => {
    expect(cellWidth('grid grid-cols-12 gap-x-8 gap-y-6', 'col-span-12 md:col-span-6', PHONE_FORM, PHONE)).toBe(352);
  });

  it('passes the one-track grid of an authored multi-column section', () => {
    expect(cellWidth('grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2', 'space-y-6', PHONE_FORM, PHONE)).toBe(PHONE_FORM);
  });
});

const FIELDS = [
  { fieldname: 'customer_name', fieldtype: 'Data', label: 'Customer name' },
  { fieldname: 'phone', fieldtype: 'Data', label: 'Phone' },
  { fieldname: 'estimate', fieldtype: 'Currency', label: 'Estimate' },
  { fieldname: 'customer_signature', fieldtype: 'Signature', label: 'Customer signature' },
] as FieldDefinition[];

describe('a form on a 360 px phone', () => {
  it('draws no cell wider than the form, the Signature pad inside its cell', async () => {
    const cells = renderCells(FIELDS);
    cells.forEach((cell, i) => {
      expect(cellWidth(cell.parentElement!.className, cell.className, PHONE_FORM, PHONE), FIELDS[i]!.fieldname).toBeLessThanOrEqual(
        PHONE_FORM,
      );
    });
    const signature = screen.getByTestId('field:WorkOrder:customer_signature');
    expect(await within(signature).findByRole('img', { name: 'Customer signature' })).toBeInTheDocument();
  });
});

/** The intake of a workshop's work order: one section, no ColumnBreak. */
const INTAKE = [
  { fieldname: 'customer', fieldtype: 'Link', label: 'Customer', options: 'Customer' },
  { fieldname: 'bike', fieldtype: 'Link', label: 'Bike', options: 'Bike' },
  { fieldname: 'received_on', fieldtype: 'Date', label: 'Received on' },
  { fieldname: 'quantity', fieldtype: 'Int', label: 'Quantity' },
  { fieldname: 'complaint', fieldtype: 'SmallText', label: 'Complaint' },
  { fieldname: 'parts', fieldtype: 'Table', label: 'Parts', options: 'WorkOrderPart' },
  { fieldname: 'notes', fieldtype: 'Text', label: 'Notes' },
] as FieldDefinition[];

/** The grid every width drew before a phone got its own; from md on the form still draws it. */
const TABLET_AND_DESKTOP_GRID = 'grid grid-cols-12 gap-x-8 gap-y-6';

describe('a section without ColumnBreak on a 390 px phone', () => {
  it('draws every field of the section inside the card', () => {
    const cells = renderCells(INTAKE);
    cells.forEach((cell, i) => {
      expect(cellWidth(cell.parentElement!.className, cell.className, phoneForm(390), 390), INTAKE[i]!.fieldname).toBeLessThanOrEqual(
        phoneForm(390),
      );
    });
  });

  it('keeps the grid of md and lg', () => {
    const [cell] = renderCells(INTAKE);
    for (const viewport of [768, 1024, 1280]) {
      expect(gridAt(cell!.parentElement!.className, viewport)).toEqual(gridAt(TABLET_AND_DESKTOP_GRID, viewport));
    }
    expect(gridAt(cell!.parentElement!.className, 768)).toEqual({ tracks: 12, columnGap: 32 });
  });
});

// The skeleton stands where the form settles, so it lays out the cells of a section as the form does.
describe('the loading skeleton of a record on a 360 px phone', () => {
  function skeletonCells(): HTMLElement[] {
    const meta = { name: 'WorkOrder', fields: INTAKE, permissions: [] } as unknown as EntityDefinition;
    const { container } = render(<RecordSkeleton meta={meta} />);
    const grid = container.querySelector<HTMLElement>('section > .grid');
    if (!grid) throw new Error('the skeleton draws no section grid');
    return Array.from(grid.children) as HTMLElement[];
  }

  it('draws every bar of the section inside the card', () => {
    const cells = skeletonCells();
    expect(cells).toHaveLength(INTAKE.length);
    cells.forEach((cell, i) => {
      expect(cellWidth(cell.parentElement!.className, cell.className, PHONE_FORM, PHONE), INTAKE[i]!.fieldname).toBeLessThanOrEqual(
        PHONE_FORM,
      );
    });
  });

  it('keeps the grid of md and lg', () => {
    const [cell] = skeletonCells();
    for (const viewport of [768, 1024, 1280]) {
      expect(gridAt(cell!.parentElement!.className, viewport)).toEqual(gridAt(TABLET_AND_DESKTOP_GRID, viewport));
    }
  });
});
