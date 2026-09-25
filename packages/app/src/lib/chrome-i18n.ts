import { useI18nStore } from '@/stores/i18n';
import en from '@/locales/en.json';
import de from '@/locales/de.json';
import es from '@/locales/es.json';
import tr from '@/locales/tr.json';
import it from '@/locales/it.json';
import fr from '@/locales/fr.json';

/**
 * Static UI-chrome translator (`ui.*` keys), reactive on the session locale.
 * DATA + META labels localize via the i18n store (tField/tOption/tEntity); this
 * covers the fixed chrome strings (buttons, status, dialogs) bundled with the app
 * so they work pre-boot and don't depend on backend translations. A missing key
 * warns in dev and renders the key (loud, never silent).
 */

type Bundle = Record<string, string>;
const BUNDLES: Record<string, Bundle> = {
  en: en as Bundle,
  de: de as Bundle,
  es: es as Bundle,
  tr: tr as Bundle,
  it: it as Bundle,
  fr: fr as Bundle,
};

function interpolate(tpl: string, params?: Record<string, string | number>): string {
  if (!params) return tpl;
  let out = tpl;
  for (const [k, v] of Object.entries(params)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return out;
}

export type ChromeTranslate = (key: string, params?: Record<string, string | number>) => string;

export function useChrome(): ChromeTranslate {
  const locale = useI18nStore((s) => s.locale);
  const bundle = BUNDLES[locale] ?? BUNDLES['en']!;
  return (key, params) => {
    const value = bundle[key] ?? BUNDLES['en']![key];
    if (value === undefined) {
      if (import.meta.env.DEV) console.warn(`[chrome-i18n] missing key "${key}"`);
      return key;
    }
    return interpolate(value, params);
  };
}
