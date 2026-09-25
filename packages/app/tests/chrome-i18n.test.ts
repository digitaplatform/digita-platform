import { describe, it, expect } from 'vitest';
import en from '@/locales/en.json';
import de from '@/locales/de.json';

describe('chrome i18n bundles', () => {
  it('de defines every en key (no missing translation)', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty values', () => {
    for (const [k, v] of Object.entries(en)) expect(v, `en.${k}`).not.toBe('');
    for (const [k, v] of Object.entries(de)) expect(v, `de.${k}`).not.toBe('');
  });

  it('keeps interpolation placeholders consistent across locales', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(de[k]), `placeholders for ${k}`).toEqual(placeholders(en[k]));
    }
  });
});
