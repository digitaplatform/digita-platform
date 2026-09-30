import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldDefinition, FormLayoutConfig } from '@digitaplatform/shared';
import { computeLayout } from '@/components/render/layout';

// When a form tabs is written down twice: the layout applies the defaults of `tabify` and
// `min_tab_fields`, and the comment of FormLayoutConfig states them to the author of an app, who
// decides from it whether a form shows as tabs. Both must name one number, so the tests find the
// defaults from what the layout does and read the comment against them.
const ENTITY_TYPES = join(__dirname, '../../shared/src/types/entity.ts');

const field = (fieldtype: string, fieldname: string) => ({ fieldname, fieldtype, label: fieldname }) as unknown as FieldDefinition;
const section = (name: string, dataFields: number) => [
  field('SectionBreak', name),
  ...Array.from({ length: dataFields }, (_, i) => field('Data', `${name}_${i}`)),
];

/** A form of `dataFields` data fields in two sections, the second holding three of them. */
const twoSections = (dataFields: number) => [...section('intake', dataFields - 3), ...section('billing', 3)];
const tabKeys = (fields: FieldDefinition[], form?: FormLayoutConfig) => computeLayout(fields, form).map((tab) => tab.key);

/** The fewest data fields at which the layout tabs a form of two sections by default. */
function appliedTabify(): number {
  for (let count = 6; count <= 100; count++) if (tabKeys(twoSections(count)).length > 1) return count;
  throw new Error('the layout tabs no form of two sections up to 100 data fields');
}

/** The fewest data fields that give a section its own tab by default, after a first tab. */
function appliedMinTabFields(): number {
  for (let count = 1; count <= 20; count++) {
    if (tabKeys([...section('intake', 30), ...section('parts', count)]).includes('parts')) return count;
  }
  throw new Error('the layout gives no section up to 20 data fields its own tab');
}

/** The number the comment of `key` in FormLayoutConfig states as "Default N", if it states one. */
function statedDefault(source: string, key: string): number | undefined {
  const config = /export interface FormLayoutConfig \{([\s\S]*?)\n\}/.exec(source)?.[1];
  if (config === undefined) throw new Error('no FormLayoutConfig in the source');
  const comment = new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${key}\\?:`).exec(config)?.[1];
  if (comment === undefined) throw new Error(`no comment on ${key} in FormLayoutConfig`);
  const stated = /Default (\d+)/.exec(comment)?.[1];
  return stated === undefined ? undefined : Number(stated);
}

/** Every key of FormLayoutConfig in `source` whose comment states another default than the layout applies. */
function misstatedDefaults(source: string): string[] {
  const applied = { tabify: appliedTabify(), min_tab_fields: appliedMinTabFields() };
  return Object.entries(applied)
    .filter(([key, value]) => statedDefault(source, key) !== value)
    .map(([key, value]) => `${key}: the comment states ${statedDefault(source, key)}, the layout applies ${value}`);
}

const configSource = (tabifyComment: string, minTabFieldsComment: string) => `
export interface FormLayoutConfig {
  /** ${tabifyComment} */
  tabify?: number;
  /**
   * ${minTabFieldsComment}
   */
  min_tab_fields?: number;
}
`;

describe('the tabify default', () => {
  it('tabs a form of two sections at 12 data fields', () => {
    expect(tabKeys(twoSections(12))).toEqual(['intake', 'billing']);
  });

  it('keeps a form of two sections with 11 data fields on one page', () => {
    expect(tabKeys(twoSections(11))).toEqual(['_details']);
  });
});

describe('the min_tab_fields default', () => {
  it('gives a section of 3 data fields its own tab and merges one of 2 into the tab before it', () => {
    const fields = [...section('intake', 10), ...section('parts', 2), ...section('billing', 3)];
    const tabs = computeLayout(fields);
    expect(tabs.map((tab) => tab.key)).toEqual(['intake', 'billing']);
    expect(tabs[0]!.sections.map((s) => s.key)).toEqual(['intake', 'parts']);
  });
});

describe('an entity form that sets tabify and min_tab_fields', () => {
  it('tabs at the tabify it sets and not one field below', () => {
    expect(tabKeys(twoSections(20), { tabify: 20 })).toEqual(['intake', 'billing']);
    expect(tabKeys(twoSections(19), { tabify: 20 })).toEqual(['_details']);
    expect(tabKeys(twoSections(6), { tabify: 6 })).toEqual(['intake', 'billing']);
    expect(tabKeys(twoSections(5), { tabify: 6 })).toEqual(['_details']);
  });

  it('gives a section its own tab at the min_tab_fields it sets and merges one field below', () => {
    const fields = [...section('intake', 6), ...section('parts', 4), ...section('billing', 5)];
    expect(tabKeys(fields, { layout: 'tabbed', min_tab_fields: 5 })).toEqual(['intake', 'billing']);
    expect(tabKeys(fields, { layout: 'tabbed', min_tab_fields: 4 })).toEqual(['intake', 'parts', 'billing']);
    expect(tabKeys(fields, { layout: 'tabbed', min_tab_fields: 1 })).toEqual(['intake', 'parts', 'billing']);
  });
});

describe('the defaults FormLayoutConfig states', () => {
  it('finds a planted comment that states another default than the layout applies', () => {
    const planted = configSource('Data-field count at/above which "auto" tabs the form. Default 16.', 'Default 3 (1 = never merge).');
    expect(misstatedDefaults(planted)).toEqual(['tabify: the comment states 16, the layout applies 12']);
  });

  it('passes a comment that states the defaults the layout applies', () => {
    const innocent = configSource('Data-field count at/above which "auto" tabs the form. Default 12.', 'Default 3 (1 = never merge).');
    expect(misstatedDefaults(innocent)).toEqual([]);
  });

  it('states the defaults the layout applies', () => {
    expect(misstatedDefaults(readFileSync(ENTITY_TYPES, 'utf-8'))).toEqual([]);
  });
});
