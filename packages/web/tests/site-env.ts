/**
 * The config of a test that reads the site's texts: TRANSLATIONS_DIR stays as the pod reads it,
 * every other required setting is any value. getConfig reads the environment on first use, so a
 * test calls this before it renders.
 */
export function setSiteEnv(): void {
  Object.assign(process.env, {
    ENGINE_URL: "http://engine.internal:3000",
    SITE_ID: "example",
    SITE_URL: "https://example.org",
    PUBLIC_ENGINE_URL: "",
    REVALIDATE_SECONDS: "60",
    REVALIDATE_SECRET: "test-revalidate-secret",
    LOCALES: "en,de",
    DEFAULT_LOCALE: "en",
  });
}
