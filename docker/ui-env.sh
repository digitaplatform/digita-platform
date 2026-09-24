#!/bin/sh
# Runtime config for the operator SPA. nginx's entrypoint runs every executable
# in /docker-entrypoint.d/ before the server starts, so ONE built image serves
# every tenant, stage and app: the chart's envs reach the page here.
#
#   APP_BASE_PATH       the app's path on the tenant's one host, e.g. /erp. It
#                       becomes the <base href> of index.html, which every URL of
#                       the page is relative to, and window.__APP_BASE_PATH__
#                       (packages/ui/src/lib/appBase.ts).
#   AUTH_URL            the tenant IdP, e.g. https://acme.example/auth
#                       (packages/ui/src/lib/authConfig.ts).
#   AUTH_COOKIE_SUFFIX  the tenant guid on the IdP's session cookie names; empty
#                       on the platform.
#   JOBS_URL            the jobs service (packages/ui/src/services/jobs.ts).
#   REPORT_URL          the report service (packages/ui/src/lib/report-link.ts).
#
# Every one but AUTH_COOKIE_SUFFIX is required: a missing one stops the start and
# is named, rather than serving a page that calls the wrong place. Both targets
# ship with the image and are chowned to the nginx user (which may not create
# files in /usr/share/nginx/html, only rewrite what it owns): env.js and
# index.html.
set -eu

html=/usr/share/nginx/html

for name in APP_BASE_PATH AUTH_URL JOBS_URL REPORT_URL; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || { echo "ui-env: missing required env var: $name" >&2; exit 1; }
done

# The base path lands in HTML and in a JS string literal, and a base URL may name
# another origin (//host), so only plain path segments pass: / or /erp or /a/b.
printf '%s' "$APP_BASE_PATH" | grep -Eq '^(/|(/[A-Za-z0-9_-]+)+)$' \
  || { echo "ui-env: APP_BASE_PATH must be / or a path like /erp, got: $APP_BASE_PATH" >&2; exit 1; }
base_href="${APP_BASE_PATH%/}/"

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
grep -q "<base href=\"$base_href\" />" /tmp/index.html || { echo "ui-env: index.html carries no <base href=\"/\" /> to rewrite" >&2; exit 1; }
cat /tmp/index.html > "$html/index.html"
rm -f /tmp/index.html
