import { create } from 'zustand';
import type { AudienceGrant } from '@digitaplatform/shared';
import type {
  BootData,
  SessionUser,
  BootLocale,
  BootLanguage,
  BootBranding,
  BootSystemSettings,
  BootRealtime,
} from '@/types';
import { getBoot } from '@/services/boot';
import { login as apiLogin, verifyTwoFactorLogin, logout as apiLogout } from '@/services/auth';
import { attemptRefresh } from '@/services/api';
import { loadAppComposition } from '@/plugins/composition';
import { useThemeStore } from '@/stores/theme';
import { useI18nStore } from '@/stores/i18n';
import { setUserPreference } from '@/services/userPreference';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

/** Client-side language preference. The available languages + the translations
 *  themselves are 100% backend-driven (Language entity + /translations); this
 *  only remembers WHICH backend language the user picked, so it survives reload
 *  and is sent as Accept-Language to the engine's locale resolver. */
export const LOCALE_STORAGE_KEY = 'digita.locale';

export function getStoredLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The browser's preferred UI language as a bare 2-letter code (e.g. "de" from
 *  "de-CH"), or null. The auto-detect default when the user has NOT manually
 *  picked a language: it is sent as Accept-Language so the engine negotiates it
 *  against the enabled languages (falling back to the platform default if the
 *  browser language isn't enabled). Never persisted — a manual choice
 *  ([[getStoredLocale]]) always wins and re-detection follows the browser. */
export function getBrowserLocale(): string | null {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const langs = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const l of langs) {
    const base = l?.slice(0, 2).toLowerCase();
    if (base) return base;
  }
  return null;
}

/**
 * The session: who the user is + the boot payload. Identity is resolved from
 * the engine's `/boot` via the httpOnly access cookie (never a JS-readable
 * token). `bootstrap()` is the single entry point; login/2FA set the cookies
 * server-side and then re-bootstrap.
 */
interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Audience-set (ADR-A1) from /boot: which authenticated tiers this user may
   *  enter. `null` when unknown (anonymous / a pre-Phase-4 /boot that omits it) —
   *  deliberately NOT fabricated to a default, so a later hard gate treats
   *  "unknown" distinctly. Chrome-only; RBAC remains the data boundary. */
  tiers: AudienceGrant[] | null;
  locale: BootLocale | null;
  /** Languages the BACKEND offers (engine Language entity, from /boot). */
  languages: BootLanguage[];
  /** Whether the operator may switch language (Setting.allow_user_language). */
  allowUserLanguage: boolean;
  branding: BootBranding | null;
  settings: BootSystemSettings | null;
  /** Resolved default Workspace id (from /boot), or null → DashboardPage picks a fallback. */
  default_workspace: string | null;
  /** Live-sync (WebSocket) config from /boot; null until resolved, or when the
   *  engine has realtime disabled. */
  realtime: BootRealtime | null;
  pendingToken: string | null;

  hasRole: (role: string) => boolean;
  bootstrap: () => Promise<BootData | null>;
  /** Switch to one of the backend languages: reload its translations, persist the
   *  choice, and mark the document lang so the engine resolves it via Accept-Language. */
  setLocale: (code: string) => Promise<void>;
  /** Persist + apply the region formatting locale (BCP-47, e.g. "de-CH") and the
   *  display timezone — independent of the UI language, so "German UI, Swiss
   *  formatting" works. Stored under the UserPreference "locale" key (a JSON
   *  string, since the engine value field is Text; the locale resolver parses it
   *  on the next boot) so the choice roams cross-device. Applied to the in-memory
   *  locale at once, so every Intl formatter refreshes without a reboot. An empty
   *  format_locale falls back to the UI language (mirrors the engine resolver). */
  setLocaleFormat: (formatLocale: string | null, timezone: string | null) => Promise<void>;
  login: (email: string, password: string) => Promise<{ requires2fa: boolean }>;
  verify2fa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Narrow re-apply of /boot-derived state (branding + default_workspace) after a
   *  settings write — NOT a full bootstrap (keeps user/locale/status/in-flight). */
  refreshBranding: () => Promise<void>;
  /** (Re)load the app's plugin composition + layout after an in-app login. The
   *  anonymous boot had no user and loaded no plugins; without this the nav region
   *  stays empty until a full page reload. Fail-soft. */
  reloadAuthenticatedLayout: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  tiers: null,
  locale: null,
  languages: [],
  allowUserLanguage: false,
  branding: null,
  settings: null,
  default_workspace: null,
  realtime: null,
  pendingToken: null,

  hasRole: (role) => !!get().user?.roles.includes(role),

  bootstrap: async () => {
    const apply = (data: BootData | null): void => {
      if (!data) {
        set({ status: 'anonymous' });
        return;
      }
      set({
        user: data.user,
        // Prefer the authoritative grant-set from the audience block; fall back to
        // the identity mirror; null when /boot carries neither (never fabricated).
        tiers: data.audience?.grants ?? data.user?.tiers ?? null,
        locale: data.locale,
        languages: data.available_languages ?? [],
        allowUserLanguage: data.system_settings?.allow_user_language ?? false,
        branding: data.branding ?? null,
        settings: data.system_settings,
        default_workspace: data.default_workspace ?? null,
        realtime: data.realtime ?? null,
        status: data.user ? 'authenticated' : 'anonymous',
      });
      // Direction is resolved per-locale by the engine; apply it so RTL locales
      // flip the whole document (no silent ltr assumption).
      document.documentElement.dir = data.locale?.direction ?? 'ltr';
      if (data.branding) useThemeStore.getState().setBranding(data.branding);
      // Roam per-user theme/density from UserPreference (localStorage was the
      // fast pre-auth default; the server value wins once we're authenticated).
      if (data.user) void useThemeStore.getState().loadRemotePrefs();
    };

    let res = await getBoot().catch(() => null);
    let data = res?.success ? res.data : null;
    // Access cookie may have expired while a refresh cookie survives — rotate
    // once and re-boot instead of treating the user as anonymous.
    if (!data?.user && (await attemptRefresh())) {
      res = await getBoot().catch(() => null);
      data = res?.success ? res.data : null;
    }
    apply(data);
    return data;
  },

  setLocale: async (code) => {
    if (code === get().locale?.code) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, code);
    } catch {
      /* private mode / quota — non-fatal */
    }
    // Loads the backend translations for this locale + sets document.lang (which
    // the api client sends as Accept-Language → the engine resolves it on boot).
    await useI18nStore.getState().load(code);
    const cur = get().locale;
    set({ locale: cur ? { ...cur, code } : { code } });
    document.documentElement.dir = get().locale?.direction ?? 'ltr';
    // NOTE: date/number formats for the new locale refresh on next full boot
    // (the engine resolves them via Accept-Language). A future auth profile
    // update would persist the choice server-side across devices.
  },

  setLocaleFormat: async (formatLocale, timezone) => {
    const cur = get().locale;
    const fmt = formatLocale && formatLocale.trim() ? formatLocale.trim() : null;
    const tz = timezone && timezone.trim() ? timezone.trim() : null;
    // Persist as a JSON STRING — UserPreference.value is a Text field and the
    // engine locale resolver JSON.parses it. Null fields fall back server-side
    // (format_locale → UI language, timezone → none).
    await setUserPreference('locale', JSON.stringify({ format_locale: fmt, timezone: tz }));
    set({
      locale: {
        ...(cur ?? { code: document.documentElement.lang || 'en' }),
        format_locale: fmt ?? cur?.code,
        timezone: tz,
      },
    });
  },

  login: async (email, password) => {
    const res = await apiLogin({ email, password });
    if (res.status === 'two_factor_required') {
      set({ pendingToken: res.pending_token });
      return { requires2fa: true };
    }
    // authenticated — the server set the session cookies; re-resolve identity,
    // then load the plugin composition so the nav paints without a reload.
    await get().bootstrap();
    await get().reloadAuthenticatedLayout();
    return { requires2fa: false };
  },

  verify2fa: async (code) => {
    const pending = get().pendingToken;
    if (!pending) throw new Error('No pending two-factor login.');
    const res = await verifyTwoFactorLogin({ pending_token: pending, code });
    if (res.status === 'two_factor_required') throw new Error('Two-factor verification failed.');
    set({ pendingToken: null });
    await get().bootstrap();
    await get().reloadAuthenticatedLayout();
  },

  logout: async () => {
    try {
      await apiLogout();
    } catch {
      // best effort — the cookies are cleared server-side
    }
    set({ user: null, tiers: null, status: 'anonymous', pendingToken: null });
  },

  refreshBranding: async () => {
    const res = await getBoot().catch(() => null);
    const data = res?.success ? res.data : null;
    if (!data) return;
    set({ branding: data.branding ?? null, default_workspace: data.default_workspace ?? null });
    if (data.branding) useThemeStore.getState().setBranding(data.branding);
  },

  reloadAuthenticatedLayout: async () => {
    // Fail-soft: a layout/template problem must not break an otherwise-successful
    // login (resolveTemplate inside loadAppComposition can throw on a bad id).
    try {
      // Backend (data) translations are auth-gated — load them now that we're
      // authenticated (the login screen needs only the static chrome strings).
      await useI18nStore.getState().load(get().locale?.code ?? document.documentElement.lang ?? 'en');
      // Active audience is the constant `internal` today — the only wired SPA
      // runtime (dual-grant users default to internal, roadmap 2.3). Phase 5 adds
      // external/anonymous SPA arms via resolveActiveAudience(get().tiers).
      await loadAppComposition('internal', get().branding?.default_template);
    } catch (e) {
      console.error('[session] post-login layout load failed — navigation may be unavailable', e);
    }
  },
}));
