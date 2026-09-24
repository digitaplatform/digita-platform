// Runtime config placeholder. The container entrypoint (docker/ui-env.sh)
// rewrites this file at start from its APP_BASE_PATH, AUTH_URL,
// AUTH_COOKIE_SUFFIX, JOBS_URL and REPORT_URL envs. Empty values fall through
// to the dev defaults — the root path, the dev IdP, the bare cookie names, the
// local jobs and report services — so dev and a build without the entrypoint
// still serve a valid script.
window.__APP_BASE_PATH__ = '';
window.__AUTH_URL__ = '';
window.__AUTH_COOKIE_SUFFIX__ = '';
window.__JOBS_URL__ = '';
window.__REPORT_URL__ = '';
