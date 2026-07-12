import { describe, it, expect } from 'vitest';
import type { FieldDefinition } from '@digitaplatform/shared';
import { fieldSpan, SPAN_CLASS, parseLayout, computeLayout, spanClass } from '@/components/render/layout';

const f = (fieldtype: string, fieldname = 't'): FieldDefinition =>
  ({ fieldname, fieldtype, label: fieldname }) as unknown as FieldDefinition;

describe('fieldSpan (form-UX height killer)', () => {
  it('narrows compact scalars to a 4-track span', () => {
    for (const t of ['Int', 'Float', 'Currency', 'Percent', 'Check', 'Date', 'Datetime', 'Time', 'Duration', 'Rating', 'Color'])
      expect(fieldSpan(f(t))).toBe(4);
  });

  it('gives wide / rich types the full 12 tracks', () => {
    for (const t of ['Text', 'SmallText', 'Table', 'Attach', 'AttachImage', 'Signature', 'Heading', 'HTML', 'Code', 'Markdown'])
      expect(fieldSpan(f(t))).toBe(12);
  });

  it('defaults the workhorse half-width types to 6', () => {
    for (const t of ['Data', 'Link', 'Select', 'Phone', 'Password', 'Tag', 'ReadOnly', 'Barcode'])
      expect(fieldSpan(f(t))).toBe(6);
  });

  it('honors an explicit span override over the intrinsic default', () => {
    expect(fieldSpan(f('Currency'))).toBe(4); // intrinsic
    expect(fieldSpan({ ...f('Currency'), span: 'full' })).toBe(12);
    expect(fieldSpan({ ...f('Text'), span: 'sm' })).toBe(4);
    expect(fieldSpan({ ...f('Data'), span: 'md' })).toBe(6);
  });

  it('SPAN_CLASS stacks on mobile, goes 2-up at md, applies the intrinsic span at lg', () => {
    expect(SPAN_CLASS[4]).toBe('col-span-12 md:col-span-6 lg:col-span-4');
    expect(SPAN_CLASS[6]).toBe('col-span-12 md:col-span-6');
    expect(SPAN_CLASS[12]).toBe('col-span-12');
  });
});

describe('parseLayout column model (drives single- vs multi-column render)', () => {
  it('a flat field list becomes one implicit single-column section → dense-grid path', () => {
    const tabs = parseLayout([f('Data', 'a'), f('Currency', 'b'), f('Check', 'c')]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.sections).toHaveLength(1);
    expect(tabs[0]!.sections[0]!.columns).toHaveLength(1);
  });

  it('an authored ColumnBreak yields a multi-column section → kept exactly as before', () => {
    const tabs = parseLayout([f('Data', 'a'), f('ColumnBreak', 'cb'), f('Data', 'b')]);
    expect(tabs[0]!.sections[0]!.columns).toHaveLength(2);
  });
});

describe('computeLayout (auto-layout engine)', () => {
  const sb = (n: string) => f('SectionBreak', n);
  const tb = (n: string) => f('TabBreak', n);
  const cb = () => f('ColumnBreak', 'col');
  const d = (n: string) => f('Data', n);
  const many = (p: string, n: number) => Array.from({ length: n }, (_, i) => d(`${p}${i}`));
  const flat = (tabs: ReturnType<typeof computeLayout>) =>
    tabs.flatMap((t) => t.sections.flatMap((s) => s.columns.flatMap((c) => c.fields.map((x) => x.fieldname))));

  it('authored TabBreak → identical to parseLayout (form config ignored)', () => {
    const fields = [d('a'), tb('T2'), d('b')];
    expect(computeLayout(fields, { layout: 'tabbed' })).toEqual(parseLayout(fields));
  });

  it('authored ColumnBreak → fully authored, never auto-tabs', () => {
    const fields = [...many('a', 20), cb(), ...many('b', 20)];
    expect(computeLayout(fields)).toHaveLength(1);
  });

  it('≥16 data fields + ≥2 sections → sections promoted, leading fields → _tab_general', () => {
    const fields = [...many('g', 5), sb('S1'), ...many('a', 6), sb('S2'), ...many('b', 6)];
    const out = computeLayout(fields);
    expect(out.map((t) => t.key)).toEqual(['_tab_general', 'S1', 'S2']);
    expect(out[0]!.sections[0]!.label).toBe(''); // no duplicate header on the General tab
    expect(out[1]!.label).toBe('S1'); // tab title carries the section label
  });

  it('<16 data fields → single page even with 2 sections', () => {
    const fields = [...many('g', 3), sb('S1'), ...many('a', 4), sb('S2'), ...many('b', 4)]; // 11 data
    expect(computeLayout(fields)).toHaveLength(1);
  });

  it('layout:"tabbed" promotes below threshold; layout:"flat" never tabs', () => {
    const small = [...many('g', 3), sb('S1'), ...many('a', 4), sb('S2'), ...many('b', 4)];
    expect(computeLayout(small, { layout: 'tabbed' }).length).toBeGreaterThan(1);
    const big = [...many('g', 20), sb('S1'), ...many('a', 5), sb('S2'), ...many('b', 5)];
    expect(computeLayout(big, { layout: 'flat' })).toHaveLength(1);
  });

  it('a section with <min_tab_fields merges into the previous tab, keeping its header', () => {
    const fields = [...many('g', 5), sb('Big'), ...many('a', 6), sb('Tiny'), ...many('b', 2)];
    const out = computeLayout(fields, { layout: 'tabbed' });
    expect(out.map((t) => t.key)).toEqual(['_tab_general', 'Big']);
    expect(out[1]!.sections.map((s) => s.key)).toEqual(['Big', 'Tiny']); // Tiny merged in
    expect(out[1]!.sections[1]!.label).toBe('Tiny'); // merged section keeps its header
  });

  it('census invariant: no data field lost or reordered', () => {
    const fields = [...many('g', 5), sb('S1'), ...many('a', 6), sb('S2'), ...many('b', 6)];
    const inputData = fields
      .filter((x) => !['SectionBreak', 'TabBreak', 'ColumnBreak'].includes(x.fieldtype))
      .map((x) => x.fieldname);
    expect(flat(computeLayout(fields))).toEqual(inputData);
  });
});

describe('spanClass (columns density cap)', () => {
  const f2 = (t: string) => f(t, 'x');
  it('no cap → intrinsic span class', () => {
    expect(spanClass(f2('Currency'))).toBe(SPAN_CLASS[4]);
    expect(spanClass(f2('Data'))).toBe(SPAN_CLASS[6]);
  });
  it('columns:2 widens narrow (4) fields to 6; columns:1 makes every field full-width', () => {
    expect(spanClass(f2('Currency'), 2)).toBe(SPAN_CLASS[6]);
    expect(spanClass(f2('Data'), 1)).toBe(SPAN_CLASS[12]);
  });
  it('an explicit field.span wins over the cap', () => {
    expect(spanClass({ ...f2('Currency'), span: 'sm' }, 1)).toBe(SPAN_CLASS[4]);
  });
});
