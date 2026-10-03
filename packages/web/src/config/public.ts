/**
 * The subset of runtime config that is safe to expose to the browser (no engine
 * internal URL, no secrets). The server reads it from env and injects it into the
 * client via <ConfigProvider> at request time — so ONE image serves any site,
 * configured purely by env (no NEXT_PUBLIC build-time bake).
 */
export interface PublicSiteConfig {
  siteId: string;
  siteUrl: string;
  /** Public metadata URLs derived by the tenant chart; never internal service addresses. */
  versionEndpoints: string[];
  /** Engine origin the BROWSER uses for public media; "" = same-origin via ingress. */
  publicEngineUrl: string;
  locales: string[];
  defaultLocale: string;
  /** Whether the contact sheet is offered; a call to action that opens it renders only then. */
  contactEnabled: boolean;
  /** The texts of the locale's not-found page, read on the server; the page itself is a client
   *  component without a locale param. */
  notFound: { title: string; body: string; home: string };
}
