import { create } from 'zustand';
import { getTranslations } from '@/services/translations';
import { humanize } from '@/lib/localize-meta';

/**
 * Platform data translations (hierarchical keys: entity.X / field.X.f /
 * option.X.f.v / system.*). Loaded once per locale; the meta renderers call
 * tField/tOption so labels localize with no per-feature strings.
 */
interface I18nState {
  locale: string;
  translations: Record<string, string>;
  loaded: boolean;
  /** Loads a language's texts and makes it the current one. Rejects with a
   *  TranslationsLoadError, keeping the texts it had, when they do not load. */
  load: (locale: string) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  tField: (entity: string, field: string, fallback?: string) => string;
  tOption: (entity: string, field: string, value: string) => string;
  /** Localized entity label (`entity.{Entity}`); falls back to the given label or the name. */
  tEntity: (entity: string, fallback?: string) => string;
  /** Localized section/tab label — sections are fields, so they share the field namespace. */
  tSection: (entity: string, section: string, fallback?: string) => string;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return out;
}

/** The texts of a language did not load. An empty map in their place would show raw
 *  labels without a word, so the failure names the language for the person to see. */
export class TranslationsLoadError extends Error {
  constructor(
    readonly language: string,
    cause: unknown,
  ) {
    super(`The texts in "${language}" could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'TranslationsLoadError';
  }
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: 'en',
  translations: {},
  loaded: false,

  load: async (locale) => {
    const res = await getTranslations(locale).catch((error: unknown) => {
      throw new TranslationsLoadError(locale, error);
    });
    if (!res.success || !res.data) throw new TranslationsLoadError(locale, res.error?.detail ?? 'the engine answered without texts');
    document.documentElement.lang = locale;
    set({ locale, translations: res.data, loaded: true });
  },

  t: (key, params) => {
    const value = get().translations[key];
    return value === undefined ? key : interpolate(value, params);
  },

  tField: (entity, field, fallback) => {
    return get().translations[`field.${entity}.${field}`] ?? fallback ?? humanize(field);
  },

  tOption: (entity, field, value) => {
    return get().translations[`option.${entity}.${field}.${value}`] ?? value;
  },

  tEntity: (entity, fallback) => {
    return get().translations[`entity.${entity}`] ?? fallback ?? humanize(entity);
  },

  tSection: (entity, section, fallback) => {
    return get().translations[`field.${entity}.${section}`] ?? fallback ?? humanize(section);
  },
}));
