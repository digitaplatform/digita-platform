// Runtime config placeholder. The container entrypoint (docker/ui-env.sh)
// rewrites this file at start from its AUTH_URL and AUTH_COOKIE_SUFFIX envs.
// Empty values fall through to the defaults in src/lib/authConfig.ts — the dev
// IdP and the bare cookie names — so dev and a build without the entrypoint
// still serve a valid script.
window.__AUTH_URL__ = '';
window.__AUTH_COOKIE_SUFFIX__ = '';
