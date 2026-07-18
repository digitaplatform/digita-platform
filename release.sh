#!/usr/bin/env bash
# release.sh — cut a stage-neutral release of this repo's @digitaplatform/* packages.
#
#   Usage:  ./release.sh <version> <channel>
#     version   X.Y.Z              e.g. 1.4.0
#     channel   stable | beta | alpha
#
# stable  -> publishes PLAIN X.Y.Z (npm dist-tag 'latest') so consumer caret
#            ranges (^X.Y.Z) actually resolve it — a prerelease suffix would not.
# beta    -> publishes X.Y.Z-beta  as a prerelease (dist-tag 'beta').
# alpha   -> publishes X.Y.Z-alpha as a prerelease (dist-tag 'alpha').
#
# Bumps every workspace package to the release version (lockstep), commits, tags,
# pushes, and opens a GitHub release. The publish to GitHub Packages is done by
# .github/workflows/release.yml when the tag lands — no local npm auth needed.
# Stage-neutral: it takes no environment/stage config, only version + channel.
# The PowerShell twin (release.ps1) drives the same pnpm/npm/git/gh commands.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)" # run from the repo root regardless of cwd

VERSION="${1:-}"
CHANNEL="${2:-}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z (got '${VERSION:-<none>}')"
case "$CHANNEL" in
  stable | beta | alpha) ;;
  *) die "channel must be stable|beta|alpha (got '${CHANNEL:-<none>}')" ;;
esac

if [[ "$CHANNEL" == "stable" ]]; then FULL="$VERSION"; else FULL="${VERSION}-${CHANNEL}"; fi
TAG="v${FULL}"

command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) is required and must be authenticated"
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean — commit or stash first"
git fetch --tags --quiet origin 2>/dev/null || true
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then die "tag ${TAG} already exists locally"; fi
if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then die "tag ${TAG} already exists on origin"; fi

printf 'Releasing %s …\n' "$TAG"

# Lockstep version bump (install-free walker; private packages bumped but never published).
node scripts/bump-version.mjs "$FULL"

git add -u # only tracked files (the bumped package.json) — never sweep untracked
git commit -m "release: ${TAG}"
git tag -a "${TAG}" -m "${TAG}"
git push origin HEAD
git push origin "${TAG}"

NOTES="Automated release ${TAG}. @digitaplatform/* packages publish to GitHub Packages via CI."
if [[ "$CHANNEL" == "stable" ]]; then
  gh release create "${TAG}" --title "${TAG}" --notes "${NOTES}"
else
  gh release create "${TAG}" --title "${TAG}" --notes "${NOTES}" --prerelease
fi

DIST=$([[ "$CHANNEL" == stable ]] && echo latest || echo "$CHANNEL")
printf 'Done. CI will build + publish to npm.pkg.github.com (dist-tag: %s).\n' "$DIST"
