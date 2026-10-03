#!/usr/bin/env bash
# Every check this repository has to pass, in order, before a push: the pre-push hook runs this file.
# It stops at the first red step and names it. The steps are the ones .github/workflows/ci.yml runs
# in its build, app, web and engine jobs; the web image (its web-image job) is not built here, because
# it needs a registry credential written to a file for the docker build.
#
# The tests read the texts of digitaplatform/digita-translations master, never a copy kept here: code
# and texts are versioned apart, and a key the code names must be in its build's folder there. Each
# package's tests get TRANSLATIONS_DIR, the folder of their own build, as its pod does.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

fail() {
  echo "check: FAIL — $1"
  exit 1
}

for tool in curl tar pnpm; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not on this machine (PATH)"
done

tmp="$(mktemp -d)" || fail "no temporary directory"
trap 'rm -rf "$tmp"' EXIT

echo "check: 1/10 pnpm build (shared, theme, components, plugins, engine, app with its vendor bundles, web)"
pnpm build || fail "pnpm build"

echo "check: 2/10 pnpm --filter @digitaplatform/app lint"
pnpm --filter @digitaplatform/app lint || fail "pnpm --filter @digitaplatform/app lint"

echo "check: 3/10 typecheck of app, web and engine (each package's own typecheck script)"
pnpm --filter @digitaplatform/app --filter @digitaplatform/web --filter @digitaplatform/engine typecheck \
  || fail "typecheck of app, web and engine"

echo "check: 4/10 pnpm --filter @digitaplatform/engine depcruise (dependency rules)"
pnpm --filter @digitaplatform/engine depcruise || fail "pnpm --filter @digitaplatform/engine depcruise"

echo "check: 5/10 download digita-translations master"
curl -fsSL https://codeload.github.com/digitaplatform/digita-translations/tar.gz/master \
  | tar -xz -C "$tmp" --strip-components=1 \
  || fail "download digita-translations master"
translations="$tmp/translations"

echo "check: 6/10 tests of shared, theme, components and the plugin SDK"
pnpm --filter @digitaplatform/shared --filter @digitaplatform/theme --filter @digitaplatform/components \
  --filter @digitaplatform/plugins test \
  || fail "tests of shared, theme, components and the plugin SDK"

echo "check: 7/10 pnpm --filter @digitaplatform/app test (texts: translations/digita-app)"
TRANSLATIONS_DIR="$translations/digita-app" pnpm --filter @digitaplatform/app test \
  || fail "pnpm --filter @digitaplatform/app test"

echo "check: 8/10 pnpm --filter @digitaplatform/web test (texts: translations/digita-web)"
TRANSLATIONS_DIR="$translations/digita-web" pnpm --filter @digitaplatform/web test \
  || fail "pnpm --filter @digitaplatform/web test"

# VITEST_MAX_WORKERS=2 is the fork count CI runs the suite with; vitest.config.ts documents the
# isolation this mirrors.
echo "check: 9/10 pnpm --filter @digitaplatform/engine test (texts: translations/digita-engine, 2 workers)"
TRANSLATIONS_DIR="$translations/digita-engine" VITEST_MAX_WORKERS=2 pnpm --filter @digitaplatform/engine test \
  || fail "pnpm --filter @digitaplatform/engine test"

echo "check: 10/10 node --test deploy/after-release.test.mjs (the translations promote after a release)"
node --test deploy/after-release.test.mjs || fail "node --test deploy/after-release.test.mjs"
echo "check: not covered here: the web image (docker/web.Dockerfile); CI's web-image job builds it."
echo "check: OK — every check green"
