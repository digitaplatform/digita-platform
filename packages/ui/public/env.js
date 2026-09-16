// Runtime config placeholder. The container entrypoint (docker/ui-env.sh)
// rewrites this file at start from its AUTH_URL env. An empty value falls
// through to the dev IdP default in src/lib/authConfig.ts, so dev and a build
// without the entrypoint still serve a valid script.
window.__AUTH_URL__ = '';
