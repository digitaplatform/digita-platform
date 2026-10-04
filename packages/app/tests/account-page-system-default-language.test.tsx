// @vitest-environment jsdom
// "System default" on the profile card clears the language at the IdP and also forgets this
// device's own pick, so the page takes the language a fresh boot resolves. A named language
// is still this device's pick, as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readBundle } from '@digitaplatform/shared/i18n-node';
import { DialogHostProvider } from '@/components/overlay/DialogHost';
import { useSessionStore, LOCALE_STORAGE_KEY } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import type { BootData, BootLanguage, SessionUser } from '@/types';
import AccountPage from '@/pages/AccountPage';

const de = readBundle(process.env.TRANSLATIONS_DIR!)['de']!;
const languages: BootLanguage[] = [
  { code: 'en', native_name: 'English', direction: 'ltr' },
  { code: 'de', native_name: 'Deutsch', direction: 'ltr' },
  { code: 'fr', native_name: 'Français', direction: 'ltr' },
];
const user: SessionUser = { _id: 'u1', email: 'ada@example.com', roles: [], language: 'de' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** The engine's boot: the profile language was cleared, so it resolves the Accept-Language
 *  it is sent, and English without one, as its default. A boot in German answers last, so a
 *  boot started with the old language would overtake the reset if the two raced. */
async function boot(acceptLanguage: string | undefined): Promise<Response> {
  if (acceptLanguage === 'de') await new Promise((r) => setTimeout(r, 30));
  const code = acceptLanguage && languages.some((l) => l.code === acceptLanguage) ? acceptLanguage : 'en';
  const data: Partial<BootData> = {
    user: { ...user, language: undefined },
    locale: { code, direction: 'ltr', format_locale: code },
    available_languages: languages,
  };
  return json({ success: true, messages: [], data });
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
  document.documentElement.lang = 'de';
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(String(url), window.location.origin).pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (method === 'GET' && path === '/api/v1/auth/sessions') return json([]);
    if (method === 'POST' && path === '/api/v1/auth/profile') {
      const body = JSON.parse(String(init?.body)) as { language: string };
      return json({ ...user, language: body.language || undefined });
    }
    if (method === 'GET' && path === '/api/v1/boot') return boot(headers['Accept-Language']);
    if (method === 'GET' && path.startsWith('/api/v1/translations/')) return json({ success: true, messages: [], data: {} });
    throw new Error(`unexpected fetch: ${method} ${path}`);
  });
  useI18nStore.setState({ locale: 'de' });
  useSessionStore.setState({
    status: 'authenticated',
    user,
    languages,
    locale: { code: 'de', direction: 'ltr', format_locale: 'de' },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useI18nStore.setState({ locale: 'en' });
  useSessionStore.setState({ status: 'loading', user: null, languages: [], locale: null });
});

function renderAccount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <DialogHostProvider>
        <AccountPage />
      </DialogHostProvider>
    </QueryClientProvider>,
  );
  return container;
}

async function saveProfileWithLanguage(container: HTMLElement, option: string) {
  fireEvent.click(container.querySelector('[data-ui="select-trigger"]')!);
  fireEvent.click(screen.getByRole('option', { name: option }));
  fireEvent.click(screen.getByRole('button', { name: de['ui.account.profile.save'] }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: de['ui.action.save'] }));
}

describe('saving the profile language', () => {
  it('forgets the device pick on "System default" and takes the language a fresh boot resolves', async () => {
    const container = renderAccount();
    await saveProfileWithLanguage(container, de['ui.account.profile.languageDefault']!);

    await vi.waitFor(() => expect(useI18nStore.getState().locale).toBe('en'));
    await vi.waitFor(() => expect(useSessionStore.getState().locale?.code).toBe('en'));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe('en');
    // No boot still in flight may land later with the old language.
    await new Promise((r) => setTimeout(r, 100));
    expect(useSessionStore.getState().locale?.code).toBe('en');
    expect(useI18nStore.getState().locale).toBe('en');
  });

  it('keeps a named language as this device pick', async () => {
    const container = renderAccount();
    await saveProfileWithLanguage(container, 'Français');

    await vi.waitFor(() => expect(useI18nStore.getState().locale).toBe('fr'));
    await vi.waitFor(() => expect(useSessionStore.getState().locale?.code).toBe('fr'));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
  });
});


describe('a region that follows an older boot payload language', () => {
  it('keeps following es-MX when saving only a timezone', async () => {
    const mx = readBundle(process.env.TRANSLATIONS_DIR!)['es-MX']!;
    useI18nStore.setState({ locale: 'es-MX' });
    useSessionStore.setState({ locale: { code: 'es-MX', format_locale: 'es-MX', timezone: null } });
    document.documentElement.lang = 'es-MX';
    const save = vi.spyOn(useSessionStore.getState(), 'setLocaleFormat').mockResolvedValue();
    try {
      renderAccount();
      const form = screen.getByRole('heading', { name: mx['ui.account.region.title'] }).closest('form')!;
      const triggers = form.querySelectorAll<HTMLButtonElement>('[data-ui="select-trigger"]');
      expect(triggers[0]?.textContent).toContain(mx['ui.account.region.formatLocaleDefault']);
      fireEvent.click(triggers[1]!);
      fireEvent.click(screen.getByRole('option', { name: 'America/Mexico_City' }));
      fireEvent.click(within(form).getByRole('button', { name: mx['ui.account.region.save'] }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: mx['ui.account.region.save'] }));
      await vi.waitFor(() => expect(save).toHaveBeenCalledWith(null, 'America/Mexico_City'));
    } finally {
      save.mockRestore();
    }
  });
});
