// @vitest-environment jsdom
// stores/session.ts pulls in stores/theme.ts, which calls bootIdentity() (needs
// `document`) at module scope — the default 'node' suite environment has none.
import { describe, it, expect, afterEach } from 'vitest';
import { resolveBootLocale, pickBootLocale, LOCALE_STORAGE_KEY } from '@/stores/session';
import type { BootData } from '@/types';

afterEach(() => {
  localStorage.clear();
});

describe('resolveBootLocale', () => {
  it('a German profile (the boot locale) wins over an English browser guess', () => {
    expect(resolveBootLocale('de', 'en')).toBe('de');
  });

  it('falls back to the client guess when boot returned no locale', () => {
    expect(resolveBootLocale(undefined, 'en')).toBe('en');
  });

  it('falls back to English when neither boot nor the client has a guess', () => {
    expect(resolveBootLocale(undefined, undefined)).toBe('en');
  });
});

// The whole sequence App() runs, with a fake bootstrap() standing in for the network
// call: this exercises the actual code path App() calls, not just resolveBootLocale in
// isolation, so reordering pickBootLocale's own priority turns this red too.
describe('pickBootLocale', () => {
  it('a German profile from boot wins over both a stored English choice and the browser', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });

    const { resolved, data } = await pickBootLocale(async () => ({ locale: { code: 'de' } }) as BootData);

    expect(resolved).toBe('de');
    expect(data?.locale?.code).toBe('de');
  });

  it('falls back to the stored choice when boot names no locale', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');

    const { resolved } = await pickBootLocale(async () => null);

    expect(resolved).toBe('fr');
  });
});
