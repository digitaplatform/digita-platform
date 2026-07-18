#!/usr/bin/env pwsh
# release.ps1 — cut a stage-neutral release of this repo's @digitaplatform/* packages.
#
#   Usage:  ./release.ps1 <version> <channel>
#     version   X.Y.Z              e.g. 1.4.0
#     channel   stable | beta | alpha
#
# stable  -> publishes PLAIN X.Y.Z (npm dist-tag 'latest') so consumer caret
#            ranges (^X.Y.Z) actually resolve it — a prerelease suffix would not.
# beta    -> publishes X.Y.Z-beta  as a prerelease (dist-tag 'beta').
# alpha   -> publishes X.Y.Z-alpha as a prerelease (dist-tag 'alpha').
#
# Bumps every workspace package (lockstep), commits, tags, pushes, and opens a
# GitHub release. The publish to GitHub Packages is done by the release workflow
# when the tag lands. Stage-neutral. The bash twin (release.sh) is equivalent.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Version,
  [Parameter(Mandatory = $true, Position = 1)][ValidateSet('stable', 'beta', 'alpha')][string]$Channel
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot # run from the repo root regardless of cwd

function Die($msg) { Write-Error $msg; exit 1 }
# $ErrorActionPreference='Stop' does NOT catch native-exe failures — check $LASTEXITCODE.
function Run { & $args[0] @($args[1..($args.Count - 1)]); if ($LASTEXITCODE -ne 0) { Die "command failed ($LASTEXITCODE): $($args -join ' ')" } }

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { Die "version must be X.Y.Z (got '$Version')" }

$Full = if ($Channel -eq 'stable') { $Version } else { "$Version-$Channel" }
$Tag = "v$Full"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Die 'gh (GitHub CLI) is required and must be authenticated' }
if ((git status --porcelain)) { Die 'working tree is not clean — commit or stash first' }
git fetch --tags --quiet origin 2>$null
git rev-parse -q --verify "refs/tags/$Tag" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Die "tag $Tag already exists locally" }
git ls-remote --exit-code --tags origin "refs/tags/$Tag" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Die "tag $Tag already exists on origin" }

Write-Host "Releasing $Tag ..."

# Lockstep version bump (install-free walker; private packages bumped but never published).
Run node scripts/bump-version.mjs $Full

Run git add -u   # only tracked files (the bumped package.json) — never sweep untracked
Run git commit -m "release: $Tag"
Run git tag -a $Tag -m $Tag
Run git push origin HEAD
Run git push origin $Tag

$Notes = "Automated release $Tag. @digitaplatform/* packages publish to GitHub Packages via CI."
if ($Channel -eq 'stable') {
  Run gh release create $Tag --title $Tag --notes $Notes
}
else {
  Run gh release create $Tag --title $Tag --notes $Notes --prerelease
}

$dist = if ($Channel -eq 'stable') { 'latest' } else { $Channel }
Write-Host "Done. CI will build + publish to npm.pkg.github.com (dist-tag: $dist)."
