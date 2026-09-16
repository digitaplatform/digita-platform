#!/bin/sh
# Runtime config for the operator SPA. nginx's entrypoint runs every executable
# in /docker-entrypoint.d/ before the server starts, so ONE built image serves
# every tenant and stage: AUTH_URL (the tenant IdP's public base URL, from the
# chart) reaches the page here as window.__AUTH_URL__, which
# packages/ui/src/lib/authConfig.ts reads.
#
# env.js ships with the image (packages/ui/public/env.js, chowned to the nginx
# user, which may not create files in the web root), so an unset AUTH_URL still
# leaves a valid script to serve — an empty value falls through to the
# build-time default.
set -eu

# Backslash and double quote would end the JS string literal early.
escaped=$(printf '%s' "${AUTH_URL:-}" | sed 's/[\\"]/\\&/g')
printf 'window.__AUTH_URL__="%s";\n' "$escaped" > /usr/share/nginx/html/env.js
