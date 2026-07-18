#!/usr/bin/env bash
# release.sh — cut a stage-neutral release of this repo's @digitaplatform/* packages.
#
#   Usage:  ./release.sh <version> <channel>
#     version   X.Y.Z              e.g. 1.4.0
#     channel   stable | beta | alpha
#
# Bumps every workspace package to <version>-<channel> (lockstep), commits, tags
# v<version>-<channel>, pushes, and opens a GitHub release. The actual publish to
# GitHub Packages (npm.pkg.github.com) is done by .github/workflows/release.yml
# when the tag lands — so this needs no local npm auth. Stage-neutral: it takes
# no environment/stage config, only the version + channel.
#
# The PowerShell twin (release.ps1) drives the same pnpm/npm/git/gh commands.
set -euo pipefail

VERSION="${1:-}"
CHANNEL="${2:-}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z (got '${VERSION:-<none>}')"
case "$CHANNEL" in
  stable | beta | alpha) ;;
  *) die "channel must be stable|beta|alpha (got '${CHANNEL:-<none>}')" ;;
esac

FULL="${VERSION}-${CHANNEL}"
TAG="v${FULL}"

command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) is required and must be authenticated"
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean — commit or stash first"
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1 && die "tag ${TAG} already exists"

printf 'Releasing %s …\n' "$TAG"

# Lockstep version bump across every workspace package + the root manifest
# (install-free walker; private packages are bumped but never published).
node scripts/bump-version.mjs "$FULL"

git add -A
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

printf 'Done. CI will build + publish to npm.pkg.github.com (dist-tag: %s).\n' \
  "$([[ "$CHANNEL" == stable ]] && echo latest || echo "$CHANNEL")"
