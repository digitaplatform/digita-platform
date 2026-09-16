#!/bin/sh
# Runtime config for the operator SPA. nginx's entrypoint runs every executable
# in /docker-entrypoint.d/ before the server starts, so ONE built image serves
# every tenant and stage: AUTH_URL (the tenant IdP's public base URL, from the
# chart) reaches the page here as window.__AUTH_URL__, which
# packages/ui/src/lib/authConfig.ts reads, and it also carries the zone the CSP
# has to allow.
#
# Both targets ship with the image and are chowned to the nginx user (which may
# not create files in /usr/share/nginx/html or /etc/nginx, only rewrite what it
# owns): packages/ui/public/env.js and docker/nginx-ui.conf. An unset AUTH_URL
# leaves both as shipped — an empty __AUTH_URL__ falls through to the
# build-time default, and the CSP keeps its placeholder zone, which matches no
# real origin.
set -eu

# ── The IdP URL for the page ────────────────────────────────────────────
# Backslash and double quote would end the JS string literal early.
escaped=$(printf '%s' "${AUTH_URL:-}" | sed 's/[\\"]/\\&/g')
printf 'window.__AUTH_URL__="%s";\n' "$escaped" > /usr/share/nginx/html/env.js

# ── The zone for the CSP ────────────────────────────────────────────────
# connect-src must allow the cross-origin refresh/logout calls to the IdP and
# frame-src the embedded report preview, both on sibling hosts of this unit's
# zone. The image is built ONCE for every tenant, so the zone cannot be baked
# in: it is AUTH_URL's host minus its leading label
# (https://auth.acme.example → acme.example).
[ -n "${AUTH_URL:-}" ] || exit 0
host=${AUTH_URL#*://}
host=${host%%/*}
host=${host%%:*}
zone=${host#*.}
# A host with no dot leaves nothing to wildcard — keep the placeholder.
[ "$zone" != "$host" ] && [ -n "$zone" ] || exit 0

# Rewritten through a temp file because `sed -i` renames its output into
# /etc/nginx, which the nginx user does not own — it owns only this file.
sed "s|https://\*\.example\.invalid|https://*.${zone}|g" /etc/nginx/nginx.conf > /tmp/nginx.conf
cat /tmp/nginx.conf > /etc/nginx/nginx.conf
rm -f /tmp/nginx.conf
