import { create } from 'zustand';
import type { AudienceGrant } from '@digitaplatform/shared';
import type {
  BootData,
  SessionUser,
  BootLocale,
  BootLanguage,
  BootBranding,
  BootSetup,
  BootSystemSettings,
  BootRealtime,
} from '@/types';
import { getBoot } from '@/services/boot';
import { logout as apiLogout } from '@/services/auth';
import { attemptRefresh } from '@/services/api';
import { redirectToIdpLogin } from '@/lib/authConfig';
import { appUrl } from '@/lib/appBase';
import { useThemeStore } from '@/stores/theme';
import { useI18nStore } from '@/stores/i18n';
import { setUserPreference } from '@/services/userPreference';
import { updateProfile } from '@/services/account';

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

/** The browser's preferred full language tag (e.g. "es-MX"), or null. The auto-detect default
 *  when the user has NOT manually picked a language: it is sent as Accept-Language so the engine negotiates it
 *  against the enabled languages (falling back to the platform default if the
 *  browser language isn't enabled). Never persisted — a manual choice
 *  ([[getStoredLocale]]) always wins and re-detection follows the browser. */
export function getBrowserLocale(): string | null {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const langs = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  for (const l of langs) {
    if (l?.trim()) return l.trim();
  }
  return null;
}

/** The language after boot: the engine's own locale resolver already puts the token's
 *  `language` claim (remote-authn-adapter.ts buildUser → request.user.language) ahead of
 *  Accept-Language (locale-resolver.ts pickLanguage), so its answer wins here too;
 *  `clientGuess` (the manually stored choice, else the browser's language) only covers a
 *  boot call that came back with no locale at all. */
export function resolveBootLocale(bootLocaleCode: string | undefined, clientGuess: string | undefined): string {
  return bootLocaleCode ?? clientGuess ?? 'en';
}

/**
 * The whole pick, from a fresh page load to the language App() applies: the stored/browser
 * guess goes out as Accept-Language (so an anonymous /boot still negotiates it), then boot's
 * own answer — which already carries the signed-in user's profile language ahead of that
 * header — decides. Takes `bootstrap` as a parameter so a test can hand it a fixed answer
 * without touching the live store; production leaves it to the default.
 */
export async function pickBootLocale(
  bootstrap: () => Promise<BootData | null> = () => useSessionStore.getState().bootstrap(),
): Promise<{ resolved: string; data: BootData | null }> {
  const stored = getStoredLocale();
  const initial = stored ?? getBrowserLocale() ?? undefined;
  if (initial) document.documentElement.lang = initial;
  const data = await bootstrap();
  return { resolved: resolveBootLocale(data?.locale?.code, initial), data };
}

/**
 * The locale the engine resolves for `code`, so a language switch formats and lays out the
 * page as the next boot would: the direction of the language as /boot offers it, the
 * person's own region, else the language itself, and the timezone they already have. It
 * reads no Language row or preference, because a person whose roles grant neither switches
 * too. Boot distinguishes an explicit region from following the language even when both
 * are the same regional tag.
 */
function resolveLocale(code: string, current: BootLocale | null, languages: BootLanguage[]): BootLocale {
  const explicit = current?.has_format_locale_preference ?? Boolean(current?.format_locale && current.format_locale !== current.code);
  const own = explicit ? current?.format_locale : undefined;
  return {
    ...current,
    code,
    // The engine's LocaleResolver reads a Language row without a direction as left to right.
    direction: languages.find((l) => l.code === code)?.direction ?? 'ltr',
    format_locale: own ?? code,
    has_format_locale_preference: explicit,
  };
}

/**
 * The session: who the user is + the boot payload. Identity is resolved from
 * the engine's `/boot` via the httpOnly access cookie (never a JS-readable
 * token). `bootstrap()` is the single entry point. Signing IN is not here: the
 * tenant IdP owns the login and 2FA halves and sets the cookies before the
 * browser comes back (lib/authConfig.ts).
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
  /** Whether the app is set up (from /boot); null until resolved and for an anonymous caller. */
  setup: BootSetup | null;
  /** Resolved default Workspace id (from /boot), or null → DashboardPage picks a fallback. */
  default_workspace: string | null;
  /** Live-sync (WebSocket) config from /boot; null until resolved, or when the
   *  engine has realtime disabled. */
  realtime: BootRealtime | null;

  hasRole: (role: string) => boolean;
  bootstrap: () => Promise<BootData | null>;
  /** Switch to one of the backend languages: reload its translations, persist the
   *  choice, mark the document lang so the engine resolves it via Accept-Language, and
   *  take the formats and the text direction the engine resolves for it. */
  setLocale: (code: string) => Promise<void>;
  /** Forget this device's language pick and take the language a fresh boot resolves,
   *  with its texts, as App does at boot. */
  resetLocale: () => Promise<void>;
  /** Persist + apply the region formatting locale (BCP-47, e.g. "de-CH") and the
   *  display timezone — independent of the UI language, so "German UI, Swiss
   *  formatting" works. Stored under the UserPreference "locale" key (a JSON
   *  string, since the engine value field is Text; the locale resolver parses it
   *  on the next boot) so the choice roams cross-device; a demo session keeps it on
   *  its IdP session instead, since every visitor shares the demo user. Applied to the in-memory
   *  locale at once, so every Intl formatter refreshes without a reboot. An empty
   *  format_locale falls back to the UI language (mirrors the engine resolver). */
  setLocaleFormat: (formatLocale: string | null, timezone: string | null) => Promise<void>;
  /** Revoke the session at the IdP, then leave for the IdP login. */
  logout: () => Promise<void>;
  /** Narrow re-apply of /boot-derived state (branding, default_workspace and setup) after a
   *  settings write — NOT a full bootstrap (keeps user/locale/status/in-flight). */
  refreshBootState: () => Promise<void>;
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
  setup: null,
  default_workspace: null,
  realtime: null,

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
        setup: data.setup ?? null,
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
      // A demo session's user is every visitor's, so nothing roams there.
      if (data.user) {
        useThemeStore.setState({ roams: !data.user.demo });
        if (!data.user.demo) void useThemeStore.getState().loadRemotePrefs();
      }
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
    // A failed load keeps the old texts while a later boot may already name the language, so
    // a switch is a no-op only when the texts in use are this language's too.
    if (code === get().locale?.code && code === useI18nStore.getState().locale) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, code);
    } catch {
      /* private mode / quota — non-fatal */
    }
    const signedIn = get().status === 'authenticated';
    // Loads the backend translations for this locale + sets document.lang (which
    // the api client sends as Accept-Language → the engine resolves it on boot).
    // The data texts need a sign-in, so a visitor switches the chrome texts alone,
    // as App does at boot.
    if (signedIn) {
      await useI18nStore.getState().load(code, get().locale?.fallback);
    } else {
      document.documentElement.lang = code;
      useI18nStore.setState({ locale: code });
    }
    const locale = resolveLocale(code, get().locale, get().languages);
    set({ locale });
    document.documentElement.dir = locale.direction ?? 'ltr';
  },

  resetLocale: async () => {
    try {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    } catch {
      /* storage that cannot be reached holds no pick: getStoredLocale reads null too */
    }
    // The old language is still the document's and would go out as Accept-Language;
    // the boot below must send what a fresh page load sends.
    document.documentElement.lang = '';
    const { resolved, data } = await pickBootLocale(() => get().bootstrap());
    // The data texts need a sign-in, so a visitor takes the chrome texts alone, as App does.
    if (data?.user) {
      await useI18nStore.getState().load(resolved, data.locale?.fallback);
    } else {
      document.documentElement.lang = resolved;
      useI18nStore.setState({ locale: resolved });
    }
  },

  setLocaleFormat: async (formatLocale, timezone) => {
    const cur = get().locale;
    const fmt = formatLocale && formatLocale.trim() ? formatLocale.trim() : null;
    const tz = timezone && timezone.trim() ? timezone.trim() : null;
    if (get().user?.demo) {
      // Every visitor shares the demo user, so the pick stays on this visitor's IdP session,
      // and the refreshed token carries it to the engine's next /boot.
      await updateProfile({ format_locale: fmt ?? '', timezone: tz ?? '' });
      await attemptRefresh();
    } else {
      // Persist as a JSON STRING — UserPreference.value is a Text field and the
      // engine locale resolver JSON.parses it. Null fields fall back server-side
      // (format_locale → UI language, timezone → none).
      await setUserPreference('locale', JSON.stringify({ format_locale: fmt, timezone: tz }));
    }
    set({
      locale: {
        ...(cur ?? { code: document.documentElement.lang || 'en' }),
        format_locale: fmt ?? cur?.code,
        has_format_locale_preference: Boolean(fmt),
        timezone: tz,
      },
    });
  },

  logout: async () => {
    try {
      await apiLogout();
    } catch {
      // best effort — the cookies are cleared server-side
    }
    set({ user: null, tiers: null, status: 'anonymous' });
    // The IdP holds the session for every app of the zone, so signing out ends
    // on its login page (with this app's home as the bounce-back target).
    redirectToIdpLogin(`${window.location.origin}${appUrl('/')}`);
  },

  refreshBootState: async () => {
    const res = await getBoot().catch(() => null);
    const data = res?.success ? res.data : null;
    if (!data) return;
    set({
      branding: data.branding ?? null,
      default_workspace: data.default_workspace ?? null,
      setup: data.setup ?? null,
    });
    if (data.branding) useThemeStore.getState().setBranding(data.branding);
  },
}));
