// @vitest-environment jsdom
// Every demo visitor signs in as the same demo user, so a region one visitor picks must stay on
// that visitor's IdP session: it never reaches the UserPreference row every visitor would read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setUserPreference = vi.fn(async () => {});
const updateProfile = vi.fn(async () => ({}));
const attemptRefresh = vi.fn(async () => true);
vi.mock('@/services/userPreference', () => ({
  getUserPreference: vi.fn(),
  setUserPreference: (...a: unknown[]) => setUserPreference(...(a as [])),
}));
vi.mock('@/services/account', () => ({ updateProfile: (...a: unknown[]) => updateProfile(...(a as [])) }));
vi.mock('@/services/api', () => ({ attemptRefresh: () => attemptRefresh() }));

const { useSessionStore } = await import('@/stores/session');

const user = (demo?: boolean) => ({ _id: 'demo@show.test', email: 'demo@show.test', roles: ['System User'], ...(demo ? { demo } : {}) });

beforeEach(() => {
  useSessionStore.setState({
    status: 'authenticated',
    locale: { code: 'de', direction: 'ltr', format_locale: 'de', timezone: null },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ status: 'loading', user: null, locale: null });
});

describe('setLocaleFormat (#313)', () => {
  it('keeps a demo visitor\'s region on their IdP session and refreshes the token that carries it', async () => {
    useSessionStore.setState({ user: user(true) });
    await useSessionStore.getState().setLocaleFormat('de-CH', 'Europe/Zurich');

    expect(updateProfile).toHaveBeenCalledWith({ format_locale: 'de-CH', timezone: 'Europe/Zurich' });
    expect(attemptRefresh).toHaveBeenCalled();
    expect(setUserPreference).not.toHaveBeenCalled();
    expect(useSessionStore.getState().locale).toMatchObject({ format_locale: 'de-CH', timezone: 'Europe/Zurich' });
  });

  it('clears a demo visitor\'s region with empty values', async () => {
    useSessionStore.setState({ user: user(true) });
    await useSessionStore.getState().setLocaleFormat(null, null);
    expect(updateProfile).toHaveBeenCalledWith({ format_locale: '', timezone: '' });
  });

  it('stores anybody else\'s region as their own preference', async () => {
    useSessionStore.setState({ user: user() });
    await useSessionStore.getState().setLocaleFormat('de-CH', 'Europe/Zurich');
    expect(setUserPreference).toHaveBeenCalledWith('locale', JSON.stringify({ format_locale: 'de-CH', timezone: 'Europe/Zurich' }));
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
