import { createTranslator, fetchBundle, FALLBACK_LANGUAGE, type Translator } from '@digitaplatform/shared';
import { useI18nStore } from '@/stores/i18n';

/**
 * Static UI-chrome translator (`ui.*` keys), reactive on the session locale.
 * DATA + META labels localize via the i18n store (tField/tOption/tEntity); this
 * covers the fixed chrome strings (buttons, status, dialogs): the folder digita-app
 * of digitaplatform/digita-translations, which the pod serves under translations/.
 * They load before the first render (main.tsx), so they work pre-boot and don't
 * depend on backend translations. A missing key warns in dev and renders the key
 * (loud, never silent).
 */
let translator: Translator | undefined;

/** Fetches the chrome texts relative to the page's <base href>, so an app under /erp reads
 *  /erp/translations/. Rejects, naming the file, when one does not load. */
export async function loadChromeTexts(): Promise<void> {
  translator = createTranslator(await fetchBundle('translations/'), FALLBACK_LANGUAGE);
}

export type ChromeTranslate = (key: string, params?: Record<string, string | number>) => string;

export function useChrome(): ChromeTranslate {
  const locale = useI18nStore((s) => s.locale);
  const loaded = translator;
  if (!loaded) throw new Error('chrome-i18n: loadChromeTexts() has not resolved yet');
  return (key, params) => {
    const text = loaded.t(key, params, locale);
    if (text === key && import.meta.env.DEV) console.warn(`[chrome-i18n] missing key "${key}"`);
    return text;
  };
}
