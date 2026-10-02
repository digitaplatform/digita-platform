// Shared vitest setup. Runs for node AND jsdom suites, so everything here is
// environment-guarded.
import { afterEach, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { readBundle } from '@digitaplatform/shared/i18n-node';

// The chrome texts are the folder digita-app of digitaplatform/digita-translations, read from
// TRANSLATIONS_DIR as the pod serves them: never a copy kept here.
const translationsDir = process.env.TRANSLATIONS_DIR;
if (!translationsDir) {
  throw new Error('TRANSLATIONS_DIR is not set: point it at translations/digita-app of a digitaplatform/digita-translations checkout');
}
const texts = readBundle(translationsDir);

if (typeof Element !== 'undefined') {
  // jsdom implements no layout/scrolling — stub the API the kit calls during
  // arrow-key navigation.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

  // Without `globals: true` RTL's automatic cleanup never registers — wire it
  // explicitly so component tests don't leak DOM into each other.
  const { cleanup, configure } = await import('@testing-library/react');
  afterEach(cleanup);

  // A field's control is a lazy module, so findBy and waitFor wait for its import, which takes
  // seconds on a machine busy with other runs; the default of 1 s failed the push gate there.
  configure({ asyncUtilTimeout: 10_000 });

  // A component renders its chrome texts only after main.tsx has loaded them, so every DOM suite
  // loads them once, through the page's own fetch of translations/<language>.json. importActual
  // loads the real module even in a suite that mocks it; a static import here would keep every
  // suite's mock of it from taking effect.
  beforeAll(async () => {
    const { loadChromeTexts } = await vi.importActual<typeof import('@/lib/chrome-i18n')>('@/lib/chrome-i18n');
    const suiteFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const language = /^translations\/([a-z]{2})\.json$/.exec(String(url))?.[1];
      if (!language || !texts[language]) throw new Error(`unexpected fetch in test setup: ${String(url)}`);
      return new Response(JSON.stringify(texts[language]));
    }) as typeof fetch;
    try {
      await loadChromeTexts();
    } finally {
      globalThis.fetch = suiteFetch;
    }
  });
}
