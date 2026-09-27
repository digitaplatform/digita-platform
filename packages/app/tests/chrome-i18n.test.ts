// @vitest-environment jsdom
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SUPPORTED_LANGUAGES } from '@digitaplatform/shared';
import { findMissingKeys, readBundle } from '@digitaplatform/shared/i18n-node';
import { loadChromeTexts, useChrome } from '@/lib/chrome-i18n';
import { useI18nStore } from '@/stores/i18n';

// tests/setup.ts stops the run without it.
const texts = readBundle(process.env.TRANSLATIONS_DIR!);

afterEach(() => {
  vi.unstubAllGlobals();
  useI18nStore.setState({ locale: 'en' });
});

describe('the chrome texts', () => {
  // index.html carries a <base href> of the app's base path (docker/app-env.sh), so the relative
  // URL reads /erp/translations/<language>.json under /erp and /translations/ at the root; an
  // absolute "/translations/" would miss the base path.
  it('are fetched relative to the page base, one file per supported language', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(texts[url.replace(/^translations\/(\w+)\.json$/, '$1')] ?? {}));
    });
    await loadChromeTexts();
    expect(urls.sort()).toEqual(SUPPORTED_LANGUAGES.map((language) => `translations/${language}.json`).sort());
  });

  it('fail to load, naming the file, when one does not load', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('it.json') ? new Response('', { status: 404 }) : new Response('{}'),
    );
    await expect(loadChromeTexts()).rejects.toThrow('translations: translations/it.json answered 404');
  });

  it('speak the session language', () => {
    const key = Object.keys(texts.en!).find((k) => texts.de![k] !== texts.en![k])!;
    useI18nStore.setState({ locale: 'de' });
    const { result } = renderHook(() => useChrome());
    expect(result.current(key)).toBe(texts.de![key]);
  });

  // Code and texts are versioned apart: every literal key of a tc() call must be in digita-app's
  // en.json. A key built at run time, such as tc(`ui.density.${opt}`), is not seen.
  it('carry every literal key the app names', () => {
    const src = join(process.cwd(), 'src');
    expect(findMissingKeys(src, texts.en!, ['tc'])).toEqual([]);
  });
});
