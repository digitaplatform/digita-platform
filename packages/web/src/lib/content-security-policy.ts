const HOSTS_SETTING = "CONTENT_SECURITY_POLICY_HOSTS";

/** The origin a setting names. It fails and names the setting when the value is no URL. */
function originOf(setting: string, value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`[digita-web] env var ${setting} must be a URL, got "${value}"`);
  }
}

/**
 * The origins of CONTENT_SECURITY_POLICY_HOSTS, comma separated. Explicitly OPTIONAL: unset or
 * empty names none. An entry lands in the policy as it is written, so anything but a bare origin
 * fails: a path or a `;` would change what the policy allows.
 */
function listSettingOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (originOf(HOSTS_SETTING, entry) !== entry) {
        throw new Error(`[digita-web] env var ${HOSTS_SETTING} must list origins such as https://pay.example.com, got "${entry}"`);
      }
      return entry;
    });
}

/**
 * The Content-Security-Policy of a page. A script runs only with the request's nonce, or when a
 * script with the nonce loads it ('strict-dynamic', which makes a browser ignore 'self', so an
 * uploaded file on the own origin cannot run from an injected tag). The page connects only to its
 * own origin, the identity provider (AUTH_URL), where it refreshes a session, and the hosts of the
 * setting. Images and frames may come from any https host, because an editor may point an image or
 * an embed block at one; images also from `data:`, the form of a signature's backdrop graphics.
 * Styles allow 'unsafe-inline': the design tokens are `style` attributes, which no nonce can cover.
 * No other site may frame the page. Next's development server evaluates code, so development alone
 * adds 'unsafe-eval'.
 */
export function contentSecurityPolicy(nonce: string, env: Record<string, string | undefined>): string {
  const connectSources = [
    "'self'",
    ...(env.AUTH_URL ? [originOf("AUTH_URL", env.AUTH_URL)] : []),
    ...listSettingOrigins(env[HOSTS_SETTING]),
  ];
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "frame-src 'self' https:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
