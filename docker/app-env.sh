#!/bin/sh
# Runtime config for the operator SPA. nginx's entrypoint runs every executable
# in /docker-entrypoint.d/ before the server starts, so ONE built image serves
# every tenant, stage and app: the chart's envs reach the page here.
#
#   APP_BASE_PATH       the app's path on its host, e.g. /erp on the tenant's one
#                       host, or / on a host of its own. It becomes the <base href>
#                       of index.html, which every URL of the page is relative to,
#                       and window.__APP_BASE_PATH__ (packages/app/src/lib/appBase.ts).
#   AUTH_URL            the tenant IdP, e.g. https://acme.example/auth
#                       (packages/app/src/lib/authConfig.ts).
#   AUTH_COOKIE_SUFFIX  the tenant guid on the IdP's session cookie names; empty
#                       on the platform.
#   JOBS_URL            the jobs service (packages/app/src/services/jobs.ts).
#   REPORT_URL          the report service (packages/app/src/lib/report-link.ts).
#
# Every one but AUTH_COOKIE_SUFFIX is required: a missing one stops the start and
# is named, rather than serving a page that calls the wrong place. The CSP in
# nginx.conf allows exactly the origins of AUTH_URL, JOBS_URL and REPORT_URL. The
# three targets ship with the image and are chowned to the nginx user, which may
# not create files where they stand, only rewrite what it owns: env.js,
# index.html and nginx.conf. Their places are fixed in the image; the test
# (packages/app/tests/app-env-script.test.ts) points them at a temporary copy.
set -eu

html="${APP_ENV_HTML:-/usr/share/nginx/html}"
conf="${APP_ENV_NGINX_CONF:-/etc/nginx/nginx.conf}"

for name in APP_BASE_PATH AUTH_URL JOBS_URL REPORT_URL; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || { echo "app-env: missing required env var: $name" >&2; exit 1; }
done

# The base path lands in HTML and in a JS string literal, and a base URL may name
# another origin (//host), so only plain path segments pass: / or /erp or /a/b.
printf '%s' "$APP_BASE_PATH" | grep -Eq '^(/|(/[A-Za-z0-9_-]+)+)$' \
  || { echo "app-env: APP_BASE_PATH must be / or a path like /erp, got: $APP_BASE_PATH" >&2; exit 1; }
base_href="${APP_BASE_PATH%/}/"

# The service URLs land in the CSP, a response header, so only a plain http(s) URL
# passes. Their origins are the page's own on the tenant's one host, and hosts of
# their own while the tenant is routed by host; the CSP names exactly those.
origins=""
for name in AUTH_URL JOBS_URL REPORT_URL; do
  eval "value=\${$name}"
  printf '%s' "$value" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$' \
    || { echo "app-env: $name must be a plain http(s) URL, got: $value" >&2; exit 1; }
  origin=$(printf '%s' "$value" | sed -E 's#^(https?://[^/]+).*$#\1#')
  case " $origins " in *" $origin "*) ;; *) origins="${origins:+$origins }$origin" ;; esac
done

# Backslash and double quote would end the JS string literal early.
js() { printf '%s' "$1" | sed 's/[\\"]/\\&/g'; }
{
  printf 'window.__APP_BASE_PATH__="%s";\n' "$(js "$APP_BASE_PATH")"
  printf 'window.__AUTH_URL__="%s";\n' "$(js "$AUTH_URL")"
  printf 'window.__AUTH_COOKIE_SUFFIX__="%s";\n' "$(js "${AUTH_COOKIE_SUFFIX:-}")"
  printf 'window.__JOBS_URL__="%s";\n' "$(js "$JOBS_URL")"
  printf 'window.__REPORT_URL__="%s";\n' "$(js "$REPORT_URL")"
} > "$html/env.js"

# Rewritten through a temp file because `sed -i` renames its output into the web
# root, where the nginx user may not create a file — it owns only index.html.
sed "s|<base href=\"/\" />|<base href=\"$base_href\" />|" "$html/index.html" > /tmp/index.html
grep -q "<base href=\"$base_href\" />" /tmp/index.html || { echo "app-env: index.html carries no <base href=\"/\" /> to rewrite" >&2; exit 1; }
cat /tmp/index.html > "$html/index.html"
rm -f /tmp/index.html

# Filled on a container's first start; a restart of the same container finds it
# filled with the same origins, which the check below accepts.
if grep -q __SERVICE_ORIGINS__ "$conf"; then
  sed "s|__SERVICE_ORIGINS__|$origins|g" "$conf" > /tmp/nginx.conf
  cat /tmp/nginx.conf > "$conf"
  rm -f /tmp/nginx.conf
fi
grep -qF "connect-src 'self' $origins;" "$conf" || { echo "app-env: nginx.conf carries no __SERVICE_ORIGINS__ to fill" >&2; exit 1; }
