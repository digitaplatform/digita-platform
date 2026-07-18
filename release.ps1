#!/usr/bin/env pwsh
# release.ps1 — cut a stage-neutral release of this repo's @digitaplatform/* packages.
#
#   Usage:  ./release.ps1 <version> <channel>
#     version   X.Y.Z              e.g. 1.4.0
#     channel   stable | beta | alpha
#
# Bumps every workspace package to <version>-<channel> (lockstep), commits, tags
# v<version>-<channel>, pushes, and opens a GitHub release. The actual publish to
# GitHub Packages (npm.pkg.github.com) is done by .github/workflows/release.yml
# when the tag lands — so this needs no local npm auth. Stage-neutral: it takes
# no environment/stage config, only the version + channel.
#
# The bash twin (release.sh) drives the same pnpm/npm/git/gh commands.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Version,
  [Parameter(Mandatory = $true, Position = 1)][ValidateSet('stable', 'beta', 'alpha')][string]$Channel
)
$ErrorActionPreference = 'Stop'

function Die($msg) { Write-Error $msg; exit 1 }

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { Die "version must be X.Y.Z (got '$Version')" }

$Full = "$Version-$Channel"
$Tag = "v$Full"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'gh (GitHub CLI) is required and must be authenticated' }
if ((git status --porcelain)) { Die 'working tree is not clean — commit or stash first' }
git rev-parse -q --verify "refs/tags/$Tag" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Die "tag $Tag already exists" }

Write-Host "Releasing $Tag ..."

# Lockstep version bump across every workspace package + the root manifest
# (install-free walker; private packages are bumped but never published).
node scripts/bump-version.mjs $Full

git add -A
git commit -m "release: $Tag"
git tag -a $Tag -m $Tag
git push origin HEAD
git push origin $Tag

$Notes = "Automated release $Tag. @digitaplatform/* packages publish to GitHub Packages via CI."
if ($Channel -eq 'stable') {
  gh release create $Tag --title $Tag --notes $Notes
}
else {
  gh release create $Tag --title $Tag --notes $Notes --prerelease
}

$dist = if ($Channel -eq 'stable') { 'latest' } else { $Channel }
Write-Host "Done. CI will build + publish to npm.pkg.github.com (dist-tag: $dist)."
