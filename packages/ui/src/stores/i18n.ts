import { create } from 'zustand';
import { getTranslations } from '@/services/translations';

/**
 * Platform data translations (hierarchical keys: entity.X / field.X.f /
 * option.X.f.v / system.*). Loaded once per locale; the meta renderers call
 * tField/tOption so labels localize with no per-feature strings.
 */
interface I18nState {
  locale: string;
  translations: Record<string, string>;
  loaded: boolean;
  load: (locale: string) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  tField: (entity: string, field: string, fallback?: string) => string;
  tOption: (entity: string, field: string, value: string) => string;
  /** Localized entity label (`entity.{Entity}`); falls back to the given label or the name. */
  tEntity: (entity: string, fallback?: string) => string;
  /** Localized section/tab label — sections are fields, so they share the field namespace. */
  tSection: (entity: string, section: string, fallback?: string) => string;
}

/** Last-resort label when neither a translation nor a meta label exists: turn a
 *  raw identifier into Title Case words (display_name → "Display Name",
 *  itemCode → "Item Code") so the UI never shows a snake_case field name. */
function humanize(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return out;
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: 'en',
  translations: {},
  loaded: false,

  load: async (locale) => {
    const res = await getTranslations(locale).catch(() => null);
    const translations = res?.success && res.data ? res.data : {};
    document.documentElement.lang = locale;
    set({ locale, translations, loaded: true });
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
