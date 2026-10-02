// @vitest-environment jsdom
// The rule by which every page of a tenant draws its look: the tenant's default signature once its
// look arrived, the cached one before, digita for a signature the page does not offer; and the
// light/dark lock the same way. The app, the sign-in pages and the report designer share it.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  cacheDrawnSignature,
  cacheModeLock,
  drawnSignature,
  isModeLocked,
  registerSignature,
  DEFAULT_SIGNATURE_ID,
  type LookCacheKeys,
} from '../src/index.js';

const keys: LookCacheKeys = { signature: 'test:signature-cache', modeLock: 'test:mode-lock' };

beforeEach(() => {
  localStorage.clear();
  registerSignature({ id: 'workbench', name: 'Workbench', accent: '#336699' });
});

describe('the drawn signature', () => {
  it("is the tenant's default signature once its look arrived, if the page offers it", () => {
    expect(drawnSignature({ default_signature: 'workbench' }, keys)).toBe('workbench');
    expect(drawnSignature({ default_signature: 'not-offered' }, keys)).toBe(DEFAULT_SIGNATURE_ID);
    expect(drawnSignature({}, keys)).toBe(DEFAULT_SIGNATURE_ID);
  });

  it('is the signature this page drew last before the look arrived', () => {
    expect(drawnSignature(null, keys)).toBe(DEFAULT_SIGNATURE_ID);
    cacheDrawnSignature('workbench', keys);
    expect(drawnSignature(null, keys)).toBe('workbench');
  });
});

describe('the light/dark lock', () => {
  it("follows the tenant's look, and its cache before the look arrived", () => {
    expect(isModeLocked({ allow_user_theme_mode: false }, keys)).toBe(true);
    expect(isModeLocked({ allow_user_theme_mode: true }, keys)).toBe(false);
    expect(isModeLocked(null, keys)).toBe(false);
    cacheModeLock({ allow_user_theme_mode: false }, keys);
    expect(isModeLocked(null, keys)).toBe(true);
    cacheModeLock({}, keys);
    expect(isModeLocked(null, keys)).toBe(false);
  });
});
