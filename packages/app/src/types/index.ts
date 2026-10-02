/**
 * Frontend view-model types. The session user and boot payload are sourced from
 * `GET /api/v1/boot` — NOT from a JS-readable token (sessions are httpOnly
 * cookies). Branding / default_workspace are populated by the `/boot` extension;
 * they are optional until that engine track lands. Navigation is NOT here: it's
 * a plugin concern (the nav plugin reads its own entity via the resource API),
 * and plugin placement/layout comes from the plugin manifest, not /boot.
 */

import type { AudienceGrant, AudienceMap, Audience, TreeConfig } from '@digitaplatform/shared';

export interface SessionUser {
  _id: string;
  email: string;
  full_name?: string;
  language?: string;
  roles: string[];
  /** Audience-set (ADR-A1): the authenticated tiers this user may enter, from the
   *  verified token's `tiers` claim (mirrored by /boot). Never a data boundary. */
  tiers?: AudienceGrant[];
  /** A demo session: every visitor signs in as this one user, so a visitor's own choices stay
   *  on their IdP session (from /boot, mirroring the token's `demo` claim). */
  demo?: boolean;
}

/** Audience block from /boot (ADR-A1…A3): the caller's grant-set, the app's per-tier
 *  declaration, and the server-computed canEnterAudience verdict per tier. */
export interface BootAudience {
  grants: AudienceGrant[];
  app: AudienceMap;
  can_enter: Partial<Record<Audience, boolean>>;
}

export interface BootLanguage {
  code: string;
  native_name: string;
  flag_emoji?: string;
  direction?: 'ltr' | 'rtl';
}

/** Locale resolved by the engine (mirrors the engine LocaleResolver output). */
export interface BootLocale {
  code: string;
  direction?: 'ltr' | 'rtl';
  /** BCP-47 formatting locale (e.g. "de-CH") — drives Intl number/date/currency.
   *  Region-aware, independent of `code` (the UI language). */
  format_locale?: string;
  /** IANA timezone for datetime display (e.g. "Europe/Zurich"). */
  timezone?: string | null;
}

export interface BootSystemSettings {
  /** Optional — the platform bakes in no currency; null when unset. */
  default_currency: string | null;
  allow_user_language: boolean;
  /** The tenant's time zone (Setting.timezone, IANA), whose day `__today__` names. */
  timezone: string;
}

/** Branding payload (from BrandingSetting via the /boot extension). */
export interface BootBranding {
  app_name?: string;
  logo?: string;
  logo_dark?: string;
  favicon?: string;
  primary_color?: string;
  accent_palette?: string;
  density?: 'comfortable' | 'compact';
  default_template?: string;
  default_signature?: string;
  allow_user_theme_mode?: boolean;
  login_background?: string;
}

/** Live-sync (WebSocket) transport config from /boot. Absent/disabled → the UI
 *  never opens a socket (the engine has REALTIME off). */
export interface BootRealtime {
  enabled: boolean;
  /** WS path on the same origin (e.g. "/ws"), routed to the engine by the ingress. */
  path: string;
}

/** A settings record of the app that its own save would refuse as stored, which this user may write. */
export interface BootSetupRecord {
  entity: string;
  /** The fields the save would refuse. */
  fields: string[];
  /** No row is stored: only the app's reference data brings one, so there is nothing to fill in. */
  missing_record: boolean;
}

/** Whether the app is set up. While it is not, the engine refuses every new record. */
export interface BootSetup {
  complete: boolean;
  /** What keeps the setup open, as far as this user may write it; empty for everyone else. */
  records: BootSetupRecord[];
}

export interface BootData {
  user: SessionUser | null;
  locale: BootLocale;
  available_languages: BootLanguage[];
  system_settings: BootSystemSettings;
  /** null for an anonymous caller; absent from an engine older than this app. */
  setup?: BootSetup | null;
  // Populated by the /boot extension (optional until then):
  branding?: BootBranding;
  default_workspace?: string | null;
  realtime?: BootRealtime;
  /** Audience/tier resolution (ADR-A1…A3). Optional until the Phase-4 engine track. */
  audience?: BootAudience;
}

/** Summary row from the entity catalog (`GET /api/v1/meta`). */
export interface EntitySummary {
  name: string;
  module: string;
  database: string;
  label?: string;
  label_plural?: string;
  is_submittable?: boolean;
  is_single?: boolean;
  is_log?: boolean;
  track_changes?: boolean;
  /** The entity's tree, where it declares one; `menu: "app"` makes it the app's left menu. */
  tree?: TreeConfig;
  /** Engine-flagged: a real app entity (vs engine plumbing/log/settings) — the
   *  fallback dashboard + command palette iterate the navigable set. */
  navigable?: boolean;
}
