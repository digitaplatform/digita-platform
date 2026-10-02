// @vitest-environment jsdom
// A light/dark mode, density or design the account refuses to keep is logged with its key: the next
// load takes the account's choices, so a choice lost there must not be lost in silence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_PREFERENCE_KEYS } from '@digitaplatform/theme';

const setUserPreference = vi.fn(async () => {
  throw new Error('refused');
});
vi.mock('@/services/userPreference', () => ({
  getUserPreference: async () => undefined,
  setUserPreference: (...a: unknown[]) => setUserPreference(...(a as [])),
}));

const { useThemeStore } = await import('@/stores/theme');

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('a choice the account refuses to keep', () => {
  it.each([
    ['mode', () => useThemeStore.getState().setMode('dark')],
    ['density', () => useThemeStore.getState().setDensity('compact')],
    ['design', () => useThemeStore.getState().setDesign('minimal')],
  ] as const)('PLANTED DEFECT: names the %s in the log', async (choice, pick) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    pick();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith(`[identity] ${IDENTITY_PREFERENCE_KEYS[choice]} could not be kept on the account`, expect.any(Error)),
    );
  });
});
