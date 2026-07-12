/**
 * The subset of runtime config that is safe to expose to the browser (no engine
 * internal URL, no secrets). The server reads it from env and injects it into the
 * client via <ConfigProvider> at request time — so ONE image serves any site,
 * configured purely by env (no NEXT_PUBLIC build-time bake).
 */
export interface PublicSiteConfig {
  siteId: string;
  siteUrl: string;
  /** Engine origin the BROWSER uses for public media; "" = same-origin via ingress. */
  publicEngineUrl: string;
  locales: string[];
  defaultLocale: string;
}
