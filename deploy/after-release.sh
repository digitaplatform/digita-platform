#!/usr/bin/env bash
# The release kit runs this as the last step of every successful release of this repository, with
# the release tag, the release commit and the stage. It moves the stage's translations pin in
# digita-deploy to the master of digita-translations, so a code this release raises reaches a person
# as text and not as its raw key. It refuses before the pin moves when a key that the new commit
# deletes may still be read: by a literal in packages/*/src at the release commit, or by another
# repository's code, which cannot be read from here. A key built at run time from parts is not seen.
#
# Any refusal leaves the release standing; the kit then says that only this step is missing, and the
# same command runs it again once the cause is fixed.
set -euo pipefail

name=after-release
repository=digitaplatform/digita-platform
deploy_url=https://github.com/digitaplatform/digita-deploy.git
translations_url=https://github.com/digitaplatform/digita-translations.git
# The folders of digita-translations whose readers live in this repository, the ones scripts/check.sh
# hands to the app, web and engine tests.
read_here=" digita-app digita-web digita-engine "
usage="usage: bash deploy/$name.sh <tag> <commit> <dev|test|prod|none>"

refuse() {
  echo "$name: REFUSED — $1" >&2
  exit 1
}

reader_of() {
  case $1 in
    digita-auth-*) echo digitaplatform/digita-auth ;;
    digita-report-*) echo digitaplatform/digita-report ;;
    *) echo "the repository that reads translations/$1" ;;
  esac
}

# The leaf keys of a JSON text on stdin, one per line, nested keys joined with dots.
keys_of() {
  node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      const walk = (node, prefix) => {
        for (const [key, value] of Object.entries(node)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (value && typeof value === "object") walk(value, path);
          else console.log(path);
        }
      };
      try {
        walk(JSON.parse(text), "");
      } catch {
        console.error("after-release: cannot read translation keys from JSON");
        process.exitCode = 1;
      }
    });
  ' | LC_ALL=C sort -u
}

[ $# -eq 3 ] || refuse "three arguments are expected. $usage"
tag=$1 commit=$2 stage=$3
[[ $commit =~ ^[0-9a-f]{40}$ ]] || refuse "the commit must be a full 40-character sha, not '$commit'"
case $stage in
  dev | test | prod) ;;
  none)
    echo "$name: a library release deploys nothing, so no stage's texts move"
    exit 0
    ;;
  *) refuse "the stage must be dev, test, prod or none, not '$stage'. $usage" ;;
esac
[ "${GITHUB_ACTIONS:-}" != true ] ||
  refuse "the promote pushes to digita-deploy and moves a tag in digita-translations, which this workflow's token cannot do. On a machine that may push there, run: bash deploy/$name.sh $tag $commit $stage"
cd "$(dirname "$0")/.."
[ "$(git rev-parse --is-shallow-repository)" = false ] ||
  refuse "the checkout is shallow, so the previous release and its issue range cannot be checked"
git cat-file -e "$commit^{commit}" 2>/dev/null || refuse "$commit is not a commit of this checkout"

previous=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*-*' "$commit^" 2>/dev/null || true)
range=${previous:+$previous..}$commit
issues=$(git log --format=%B "$range" | node -e '
  const repository = process.argv[1];
  const owner = repository.split("/")[0];
  const messages = require("node:fs").readFileSync(0, "utf8");
  const refs = messages.match(/(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)?#[0-9]+\b/g) ?? [];
  for (const ref of new Set(refs)) {
    console.log(ref.startsWith("#") ? repository + ref : ref.includes("/") ? ref : owner + "/" + ref);
  }
' "$repository" | LC_ALL=C sort -u)
[ -n "$issues" ] ||
  refuse "no commit of ${previous:-the history}${previous:+..$tag} names an issue in its subject or body, and the pin commit names the issues it belongs to"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# The hooks path is set before the checkout, so the clone's push runs the same gate as a push from
# any other checkout of digita-deploy.
git clone -q --no-checkout "$deploy_url" "$work/deploy" || refuse "$deploy_url could not be cloned"
git -C "$work/deploy" config core.hooksPath .githooks
git -C "$work/deploy" checkout -q master >/dev/null 2>&1 || refuse "the master of $deploy_url could not be checked out"

pins=$(sed -nE '/^translations:/,/^[^[:space:]#]/ s/^  commit: *"?([0-9a-f]{40})"?.*/\1/p' \
  "$work"/deploy/charts/*/values-"$stage".yaml | sort -u)
[ -n "$pins" ] || refuse "no charts/*/values-$stage.yaml of digita-deploy carries translations.commit"
includes=$(grep -Hn 'include "digita-lib.translationsInit"' "$work"/deploy/charts/*/templates/*.yaml || true)
[ -n "$includes" ] || refuse "no chart of digita-deploy names the translations build it reads"
unread=$(printf '%s\n' "$includes" | grep -v '"build" "[^"]*"' || true)
[ -z "$unread" ] || refuse "a translations include names no readable build: $unread"
folders=$(printf '%s\n' "$includes" | sed -nE 's/.*"build" "([^"]+)".*/\1/p' | sort -u)
[ -n "$folders" ] || refuse "no chart of digita-deploy names the translations build it reads"

git init -q --bare "$work/translations"
git -C "$work/translations" fetch -q "$translations_url" refs/heads/master ||
  refuse "the master of $translations_url could not be fetched"
target=$(git -C "$work/translations" rev-parse FETCH_HEAD)
blocked=()
for pin in $pins; do
  [ "$pin" != "$target" ] || continue
  for folder in $folders; do
    file=translations/$folder/en.json
    before=$(git -C "$work/translations" show "$pin:$file" 2>/dev/null | keys_of) ||
      refuse "cannot check $file at pinned commit $pin; no texts move"
    after=$(git -C "$work/translations" show "$target:$file" 2>/dev/null | keys_of) ||
      refuse "cannot check $file at target commit $target; no texts move"
    deleted=$(LC_ALL=C comm -23 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | sed '/^$/d')
    while IFS= read -r key; do
      [ -n "$key" ] || continue
      if [[ $read_here == *" $folder "* ]]; then
        readers=$(git grep -n -F -w -e "$key" "$commit" -- 'packages/*/src/**' | cut -d: -f2-3 || true)
        while IFS= read -r reader; do
          [ -n "$reader" ] || continue
          blocked+=("$folder: $key is read at $reader")
        done <<< "$readers"
      else
        blocked+=("$folder: $key may be read by $(reader_of "$folder"), whose running code this step cannot read")
      fi
    done <<< "$deleted"
  done
done
promote_issues=()
for issue in $issues; do promote_issues+=(--issue "$issue"); done
if [ ${#blocked[@]} -gt 0 ]; then
  printf '%s\n' "${blocked[@]}" >&2
  # The release stands either way. A reader here is removed by a change and a new release; a key of
  # another repository is cleared by a person who reads that repository's running code, and who then
  # promotes with the command below from a digita-deploy checkout at the master of origin.
  refuse "$target deletes keys that may still be read (above), so $stage stays on $pins. Once no running code reads them, promote from a digita-deploy checkout at the master of origin: bash scripts/translations-promote.sh $stage $target ${promote_issues[*]}"
fi
echo "$name: no literal reader in this repository holds a key that $target deletes, and no other repository's key is deleted"

bash "$work/deploy/scripts/translations-promote.sh" "$stage" "$target" "${promote_issues[@]}"
