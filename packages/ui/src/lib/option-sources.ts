import type { SelectOption } from '@digitaplatform/components';

/**
 * Built-in dynamic option sources for Select fields declaring `options_source`.
 * App-agnostic + offline — backed by browser Intl data, so no engine/app coupling
 * and no seeded lists. Add a case here to expose a new standard list to entity JSON.
 */

function supported(key: 'timeZone' | 'currency'): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try {
    return fn ? fn(key) : [];
  } catch {
    return [];
  }
}

let currencyNames: Intl.DisplayNames | undefined;
function currencyLabel(code: string): string {
  try {
    currencyNames ??= new Intl.DisplayNames(undefined, { type: 'currency' });
    const name = currencyNames.of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

/** Resolve a declared option source to Select options. Unknown source → []. */
export function resolveOptionSource(source: string): SelectOption[] {
  switch (source) {
    case 'timezones':
      return supported('timeZone').map((tz) => ({ value: tz, label: tz }));
    case 'currencies':
      return supported('currency').map((c) => ({ value: c, label: currencyLabel(c) }));
    default:
      return [];
  }
}
