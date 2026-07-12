import { describe, it, expect } from 'vitest';
import en from '@/locales/en.json';
import de from '@/locales/de.json';
import es from '@/locales/es.json';
import tr from '@/locales/tr.json';
import itLocale from '@/locales/it.json';
import fr from '@/locales/fr.json';

/**
 * Guardrail: the chrome locale bundles (ui.* keys, consumed by `tc`/useChrome)
 * must stay key-aligned across all languages, with matching interpolation
 * placeholders and no empty values. This is what catches a key added to en.json
 * but forgotten in de/es/tr (the exact drift this i18n sweep fixed). Bundles are
 * imported the same way useChrome does (no node:fs — keeps the frontend test
 * typecheck clean without @types/node).
 */

const bundles = { en, de, es, tr, it: itLocale, fr } as Record<
  'en' | 'de' | 'es' | 'tr' | 'it' | 'fr',
  Record<string, string>
>;
const LOCALES = ['en', 'de', 'es', 'tr', 'it', 'fr'] as const;

const placeholders = (s: string): string[] => [...new Set(s.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort();

describe('chrome locale coverage', () => {
  const ref = bundles.en;
  const refKeys = Object.keys(ref);

  it('en: is the non-empty reference (keys present, no empty values)', () => {
    expect(refKeys.length).toBeGreaterThan(0);
    expect(Object.entries(ref).filter(([, v]) => !v || !v.trim()).map(([k]) => k)).toEqual([]);
  });

  for (const loc of LOCALES.filter((l) => l !== 'en')) {
    const target = bundles[loc];

    it(`${loc}: no missing or extra keys vs en`, () => {
      expect(Object.keys(target).filter((k) => !(k in ref))).toEqual([]); // extra
      expect(refKeys.filter((k) => !(k in target))).toEqual([]); // missing
    });

    it(`${loc}: interpolation placeholders match en`, () => {
      const mismatches = refKeys
        .filter((k) => k in target)
        .filter((k) => placeholders(ref[k]!).join(',') !== placeholders(target[k]!).join(','))
        .map((k) => `${k}: en{${placeholders(ref[k]!)}} ${loc}{${placeholders(target[k]!)}}`);
      expect(mismatches).toEqual([]);
    });

    it(`${loc}: no empty values`, () => {
      expect(Object.entries(target).filter(([, v]) => !v || !v.trim()).map(([k]) => k)).toEqual([]);
    });
  }
});
