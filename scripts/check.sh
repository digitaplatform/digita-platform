#!/usr/bin/env bash
# Every check this repository has to pass, in order, before a push: the pre-push hook runs this file.
# It stops at the first red local step and names it. Tests run in GitHub Actions.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail() {
  echo "check: FAIL — $1"
  exit 1
}

command -v pnpm >/dev/null 2>&1 || fail "pnpm is not on this machine (PATH)"

echo "check: 1/4 pnpm build (shared, theme, components, plugins, engine, app with its vendor bundles, web)"
pnpm build || fail "pnpm build"

echo "check: 2/4 pnpm --filter @digitaplatform/app lint"
pnpm --filter @digitaplatform/app lint || fail "pnpm --filter @digitaplatform/app lint"

echo "check: 3/4 typecheck of app, web and engine (each package's own typecheck script)"
pnpm --filter @digitaplatform/app --filter @digitaplatform/web --filter @digitaplatform/engine typecheck \
  || fail "typecheck of app, web and engine"

echo "check: 4/4 pnpm --filter @digitaplatform/engine depcruise (dependency rules)"
pnpm --filter @digitaplatform/engine depcruise || fail "pnpm --filter @digitaplatform/engine depcruise"

bash -n deploy/after-release.sh || fail "syntax of deploy/after-release.sh"
node --check deploy/after-release.test.mjs || fail "syntax of deploy/after-release.test.mjs"

echo "not run locally: @digitaplatform/shared (runs in GitHub Actions on every push)"
echo "not run locally: @digitaplatform/theme (runs in GitHub Actions on every push)"
echo "not run locally: @digitaplatform/components (runs in GitHub Actions on every push)"
echo "not run locally: @digitaplatform/plugins (runs in GitHub Actions on every push)"
echo "not run locally: @digitaplatform/app (runs in GitHub Actions on every push)"
echo "not run locally: @digitaplatform/web (runs in GitHub Actions on every push)"
echo "not run locally: @digitaplatform/engine (runs in GitHub Actions on every push)"
echo "not run locally: deploy/after-release.test.mjs (runs in GitHub Actions on every push)"

echo "check: not covered here: the web image (docker/web.Dockerfile); CI's web-image job builds it."
echo "check: OK — local checks green; tests not run locally"
